// Coletor do catálogo de obras digitais gratuitas da Livraria do Senado.
//
// Como funciona:
//   1. Lê a lista de produtos pela API pública do WooCommerce (/wp-json/wc/store/v1/products).
//   2. Abre a página de cada produto e extrai os links do bloco "Versão digital gratuita"
//      (PDF, EPUB ou página do item na Biblioteca Digital do Senado - BDSF).
//   3. Grava app/data/catalogo.json, que é lido pelo app.
//
// Uso (na pasta do projeto, requer .NET 10):
//   dotnet run coletor/coletor.cs
//   dotnet run coletor/coletor.cs -- --limite 20          (teste rápido com 20 produtos)
//   dotnet run coletor/coletor.cs -- --paralelo 2 --pausa 500 --saida outro/caminho.json
//
// Observação: os links de PDF/EPUB não aparecem na API REST porque ficam num campo
// customizado (ACF). Se o campo for exposto na API, o passo 2 deixa de ser necessário.

#:property PublishAot=false
#:property InvariantGlobalization=false
#:property Nullable=enable

using System.Collections.Concurrent;
using System.Net;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

const string Site = "https://livraria.senado.leg.br";
const string AgenteUsuario = "LivrariaSenadoApp-Prototipo/0.1 (catalogo de obras digitais gratuitas)";

var opcoes = Opcoes.Ler(args);
var caminhoSaida = Path.GetFullPath(opcoes.Saida ?? Path.Combine(Util.PastaDoScript(), "..", "app", "data", "catalogo.json"));
var relogio = System.Diagnostics.Stopwatch.StartNew();

using var http = new HttpClient(new SocketsHttpHandler
{
    AutomaticDecompression = DecompressionMethods.All,
    PooledConnectionLifetime = TimeSpan.FromMinutes(5),
})
{ Timeout = TimeSpan.FromSeconds(60) };
http.DefaultRequestHeaders.UserAgent.ParseAdd(AgenteUsuario);

// ---------------------------------------------------------------- 1. lista de produtos
Console.WriteLine("1/3  Lendo a lista de produtos pela API da loja...");
var produtos = new List<JsonObject>();
for (int pagina = 1, totalPaginas = 1; pagina <= totalPaginas; pagina++)
{
    var url = $"{Site}/wp-json/wc/store/v1/products?per_page=100&page={pagina}&orderby=title&order=asc";
    var (corpo, cabecalhos) = await Util.Baixar(http, url, CancellationToken.None);
    if (cabecalhos.TryGetValue("X-WP-TotalPages", out var tp)) totalPaginas = int.Parse(tp);
    foreach (var p in JsonNode.Parse(corpo)!.AsArray()) produtos.Add(p!.AsObject());
    Console.WriteLine($"     página {pagina}/{totalPaginas} - {produtos.Count} produtos");
}
if (opcoes.Limite > 0) produtos = produtos.Take(opcoes.Limite).ToList();

// ---------------------------------------------------------------- 2. links digitais
Console.WriteLine($"2/3  Abrindo {produtos.Count} páginas de produto ({opcoes.Paralelo} por vez)...");
var arquivosPorId = new ConcurrentDictionary<long, List<Arquivo>>();
var falhas = new ConcurrentBag<string>();
int lidas = 0;
await Parallel.ForEachAsync(produtos, new ParallelOptions { MaxDegreeOfParallelism = opcoes.Paralelo }, async (p, ct) =>
{
    var id = p["id"]!.GetValue<long>();
    var link = p["permalink"]!.GetValue<string>();
    try
    {
        var (html, _) = await Util.Baixar(http, link, ct);
        arquivosPorId[id] = Extrator.ArquivosDigitais(html);
    }
    catch (Exception e)
    {
        falhas.Add($"{link} -> {e.Message}");
    }
    var n = Interlocked.Increment(ref lidas);
    if (n % 25 == 0 || n == produtos.Count) Console.WriteLine($"     {n}/{produtos.Count} páginas lidas");
    await Task.Delay(opcoes.PausaMs, ct);
});

// ---------------------------------------------------------------- 3. catálogo
Console.WriteLine("3/3  Montando o catálogo...");
var obras = new JsonArray();
var semDigital = new List<string>();
var viaAtributo = new List<string>();

// Arquivos de cada produto: o bloco da página é a fonte principal; o atributo "LINK PDF" é a reserva.
var selecionados = new List<(JsonObject Produto, List<Arquivo> Arquivos)>();
foreach (var p in produtos.OrderBy(p => Util.Texto(p["name"]), StringComparer.Create(new System.Globalization.CultureInfo("pt-BR"), true)))
{
    var id = p["id"]!.GetValue<long>();
    var link = p["permalink"]!.GetValue<string>();
    if (!arquivosPorId.TryGetValue(id, out var arquivos)) continue; // falhou na leitura
    if (arquivos.Count == 0)
    {
        arquivos = Extrator.ArquivosDosAtributos(p);
        if (arquivos.Count > 0) viaAtributo.Add(link);
    }
    if (arquivos.Count == 0) { semDigital.Add(link); continue; }
    selecionados.Add((p, arquivos));
}

// Limpeza das categorias da loja: genéricas saem, duplicadas são unificadas, as de vitrine viram
// marcadores e as muito pequenas (que na prática são assuntos) vão para "assuntos".
var categoriasIgnoradas = new HashSet<string> { "uncategorized", "todos-os-livros", "livros", "livros-obsoleto" };
var marcadores = new Dictionary<string, string> { ["capa-destaques"] = "destaque", ["capa-lancamentos"] = "lancamento" };
var apelidos = new Dictionary<string, string> { ["legislacoes"] = "legislacao", ["constituicao"] = "constituicao-federal" };
var nomesPreferidos = new Dictionary<string, string> { ["ril"] = "Revista RIL", ["legislacao"] = "Legislação", ["constituicao-federal"] = "Constituição Federal" };
const int MinimoPorCategoria = 3;
var nomesAtributos = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
{
    ["PAGINAS"] = "Páginas", ["PÁGINA"] = "Páginas", ["Páginas"] = "Páginas", ["ANO"] = "Ano", ["EDIÇÃO"] = "Edição", ["EDICAO"] = "Edição",
};

IEnumerable<(string Slug, string Nome)> CategoriasDe(JsonObject p) =>
    (p["categories"]?.AsArray() ?? []).Select(c => (c!["slug"]!.GetValue<string>(), Util.Texto(c["name"])));
string Unificar(string slug) => apelidos.GetValueOrDefault(slug, slug);
bool Ignorar(string slug) => categoriasIgnoradas.Contains(slug) || marcadores.ContainsKey(slug) || slug.All(char.IsDigit);

var totalPorCategoria = selecionados
    .SelectMany(s => CategoriasDe(s.Produto).Where(c => !Ignorar(c.Slug)).Select(c => Unificar(c.Slug)).Distinct())
    .GroupBy(s => s).ToDictionary(g => g.Key, g => g.Count());
var nomesCategorias = new Dictionary<string, string>();

foreach (var (p, arquivos) in selecionados)
{
    var id = p["id"]!.GetValue<long>();
    var categorias = new JsonArray();
    var assuntos = new JsonArray();
    var flags = new HashSet<string>();
    foreach (var (slugOriginal, nome) in CategoriasDe(p))
    {
        if (marcadores.TryGetValue(slugOriginal, out var marcador)) { flags.Add(marcador); continue; }
        if (Ignorar(slugOriginal)) continue;
        var slug = Unificar(slugOriginal);
        if (totalPorCategoria[slug] < MinimoPorCategoria) { assuntos.Add(nome); continue; }
        if (categorias.Any(c => c!.GetValue<string>() == slug)) continue;
        nomesCategorias[slug] = nomesPreferidos.GetValueOrDefault(slug, nome);
        categorias.Add(slug);
    }

    var atributos = new JsonObject();
    foreach (var a in p["attributes"]?.AsArray() ?? [])
    {
        var nome = Util.Texto(a!["name"]);
        if (Extrator.AtributoDeLink(nome)) continue; // links já estão em "arquivos"
        nome = nomesAtributos.GetValueOrDefault(nome, nome);
        var valores = (a["terms"]?.AsArray() ?? []).Select(t => Util.Texto(t!["name"])).Where(v => v.Length > 0);
        var valor = string.Join("; ", valores);
        if (nome.Length > 0 && valor.Length > 0 && !atributos.ContainsKey(nome)) atributos[nome] = valor;
    }

    var imagem = p["images"]?.AsArray().FirstOrDefault();
    var precos = p["prices"];
    decimal? preco = null;
    if (decimal.TryParse(precos?["price"]?.GetValue<string>(), out var centavos))
        preco = centavos / (decimal)Math.Pow(10, precos?["currency_minor_unit"]?.GetValue<int>() ?? 2);
    var aVenda = (p["is_purchasable"]?.GetValue<bool>() ?? false) && (p["is_in_stock"]?.GetValue<bool>() ?? false) && preco > 0;

    var listaArquivos = new JsonArray();
    foreach (var arq in arquivos)
        listaArquivos.Add(new JsonObject { ["tipo"] = arq.Tipo, ["url"] = arq.Url, ["rotulo"] = arq.Rotulo });

    obras.Add(new JsonObject
    {
        ["id"] = id,
        ["titulo"] = Util.Texto(p["name"]),
        ["slug"] = p["slug"]!.GetValue<string>(),
        ["url"] = p["permalink"]!.GetValue<string>(),
        ["capa"] = imagem?["src"]?.GetValue<string>(),
        ["capaMini"] = imagem?["thumbnail"]?.GetValue<string>(),
        ["resumo"] = Util.HtmlParaTexto(p["short_description"]?.GetValue<string>()),
        ["descricao"] = Util.HtmlParaTexto(p["description"]?.GetValue<string>()),
        ["categorias"] = categorias,
        ["assuntos"] = assuntos,
        ["destaque"] = flags.Contains("destaque"),
        ["lancamento"] = flags.Contains("lancamento"),
        ["atributos"] = atributos,
        ["impresso"] = aVenda ? new JsonObject { ["preco"] = preco } : null,
        ["arquivos"] = listaArquivos,
    });
}

var listaCategorias = new JsonArray();
foreach (var (slug, total) in totalPorCategoria.Where(kv => kv.Value >= MinimoPorCategoria).OrderByDescending(kv => kv.Value))
    listaCategorias.Add(new JsonObject { ["slug"] = slug, ["nome"] = nomesCategorias[slug], ["total"] = total });

var catalogo = new JsonObject
{
    ["geradoEm"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
    ["fonte"] = Site,
    ["produtosLidos"] = produtos.Count,
    ["totalObras"] = obras.Count,
    ["categorias"] = listaCategorias,
    ["obras"] = obras,
};

Directory.CreateDirectory(Path.GetDirectoryName(caminhoSaida)!);
var json = catalogo.ToJsonString(new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
await File.WriteAllTextAsync(caminhoSaida, json, new UTF8Encoding(false));

// Relatório simples ao lado do coletor, útil para conferir o que ficou de fora.
var relatorio = new StringBuilder();
relatorio.AppendLine($"Coleta de {DateTime.Now:dd/MM/yyyy HH:mm}");
relatorio.AppendLine($"Produtos lidos: {produtos.Count} | Obras com versão digital: {obras.Count} | Sem versão digital: {semDigital.Count} | Falhas: {falhas.Count}");
relatorio.AppendLine().AppendLine("## Links obtidos só pelo atributo do produto (a página não mostra o bloco de versão digital)");
foreach (var v in viaAtributo.Order()) relatorio.AppendLine(v);
relatorio.AppendLine().AppendLine("## Falhas de leitura");
foreach (var f in falhas.Order()) relatorio.AppendLine(f);
relatorio.AppendLine().AppendLine("## Produtos sem versão digital");
foreach (var s in semDigital.Order()) relatorio.AppendLine(s);
// Com --saida, o relatório fica ao lado do arquivo gerado (assim um teste não apaga o relatório da coleta oficial).
var caminhoRelatorio = opcoes.Saida is null
    ? Path.Combine(Util.PastaDoScript(), "ultima-coleta.txt")
    : Path.Combine(Path.GetDirectoryName(caminhoSaida)!, Path.GetFileNameWithoutExtension(caminhoSaida) + "-relatorio.txt");
await File.WriteAllTextAsync(caminhoRelatorio, relatorio.ToString(), new UTF8Encoding(false));

Console.WriteLine();
Console.WriteLine($"Pronto em {relogio.Elapsed:mm\\:ss}.");
Console.WriteLine($"  Obras com versão digital: {obras.Count} de {produtos.Count} produtos");
Console.WriteLine($"  Sem versão digital: {semDigital.Count} | Só pelo atributo: {viaAtributo.Count} | Falhas: {falhas.Count}");
Console.WriteLine($"  Catálogo: {caminhoSaida} ({json.Length / 1024} KB)");
Console.WriteLine($"  Relatório: {caminhoRelatorio}");
return falhas.IsEmpty ? 0 : 1;

// ====================================================================== tipos auxiliares

record Arquivo(string Tipo, string Url, string Rotulo);

record Opcoes(string? Saida, int Limite, int Paralelo, int PausaMs)
{
    public static Opcoes Ler(string[] args)
    {
        string? Valor(string nome) { var i = Array.IndexOf(args, nome); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        return new Opcoes(
            Saida: Valor("--saida"),
            Limite: int.TryParse(Valor("--limite"), out var l) ? l : 0,
            Paralelo: int.TryParse(Valor("--paralelo"), out var p) ? Math.Clamp(p, 1, 8) : 3,
            PausaMs: int.TryParse(Valor("--pausa"), out var z) ? Math.Max(0, z) : 300);
    }
}

static class Extrator
{
    // Cada link do bloco "Versão digital gratuita" é um <a class="lv-dl-btn lv-dl-btn--pdf|epub|pagina" href="...">.
    static readonly Regex Link = new(@"<a\b(?<attrs>[^>]*)>(?<texto>.*?)</a>", RegexOptions.Singleline | RegexOptions.Compiled);
    static readonly Regex Href = new(@"\bhref\s*=\s*""(?<v>[^""]*)""", RegexOptions.Compiled);
    static readonly Regex Classe = new(@"\bclass\s*=\s*""(?<v>[^""]*)""", RegexOptions.Compiled);
    static readonly Regex Modificador = new(@"lv-dl-btn--(?<v>[\w-]+)", RegexOptions.Compiled);

    // O bloco termina antes do compartilhamento social ou da lista de espera.
    static readonly string[] FimDoBloco = ["custom-wc-sharing", "wc-waitlist", "</section>", "<form"];

    // Atributos do produto que guardam links ("LINK PDF", "BAIXAR EM PDF", "Link EPUB").
    public static bool AtributoDeLink(string nome) => Regex.IsMatch(nome, "link|baixar", RegexOptions.IgnoreCase);

    public static List<Arquivo> ArquivosDosAtributos(JsonObject produto)
    {
        var lista = new List<Arquivo>();
        foreach (var a in produto["attributes"]?.AsArray() ?? [])
        {
            if (!AtributoDeLink(Util.Texto(a!["name"]))) continue;
            foreach (var t in a["terms"]?.AsArray() ?? [])
            {
                var url = Util.Texto(t!["name"]);
                if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase) || lista.Any(x => x.Url == url)) continue;
                lista.Add(new Arquivo(TipoPelaUrl(url), url, Util.Texto(a["name"])));
            }
        }
        return lista;
    }

    static string TipoPelaUrl(string url) =>
        url.Contains(".pdf", StringComparison.OrdinalIgnoreCase) ? "pdf"
        : url.Contains(".epub", StringComparison.OrdinalIgnoreCase) ? "epub"
        : "pagina";

    public static List<Arquivo> ArquivosDigitais(string html)
    {
        var lista = new List<Arquivo>();
        var inicio = html.IndexOf("lv-digital__row", StringComparison.Ordinal);
        if (inicio < 0) return lista;

        var fim = Math.Min(html.Length, inicio + 20_000);
        foreach (var marca in FimDoBloco)
        {
            var i = html.IndexOf(marca, inicio, StringComparison.Ordinal);
            if (i > 0 && i < fim) fim = i;
        }

        foreach (Match m in Link.Matches(html[inicio..fim]))
        {
            var attrs = m.Groups["attrs"].Value;
            var url = WebUtility.HtmlDecode(Href.Match(attrs).Groups["v"].Value).Trim();
            if (url.Length == 0 || url.StartsWith('#')) continue;
            if (lista.Any(a => a.Url == url)) continue;

            var classe = Classe.Match(attrs).Groups["v"].Value;
            var tipo = Modificador.Match(classe).Groups["v"].Value;
            if (tipo.Length == 0 || tipo == "pagina") tipo = TipoPelaUrl(url);
            lista.Add(new Arquivo(tipo, url, Util.HtmlParaTexto(m.Groups["texto"].Value)));
        }
        return lista;
    }
}

static class Util
{
    public static string PastaDoScript([CallerFilePath] string caminho = "") => Path.GetDirectoryName(caminho)!;

    public static async Task<(string Corpo, Dictionary<string, string> Cabecalhos)> Baixar(HttpClient http, string url, CancellationToken ct)
    {
        for (var tentativa = 1; ; tentativa++)
        {
            try
            {
                using var resp = await http.GetAsync(url, ct);
                if ((int)resp.StatusCode == 429 || (int)resp.StatusCode >= 500)
                    throw new HttpRequestException($"HTTP {(int)resp.StatusCode}");
                resp.EnsureSuccessStatusCode();
                var cabecalhos = resp.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value), StringComparer.OrdinalIgnoreCase);
                return (await resp.Content.ReadAsStringAsync(ct), cabecalhos);
            }
            catch (Exception) when (tentativa < 3 && !ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(2 * tentativa), ct);
            }
        }
    }

    public static string Texto(JsonNode? no) => WebUtility.HtmlDecode(no?.GetValue<string>() ?? "").Trim();

    static readonly Regex QuebraDeLinha = new(@"<\s*br\s*/?\s*>|</\s*(p|div|li|h\d)\s*>", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Tag = new(@"<[^>]+>", RegexOptions.Compiled);
    static readonly Regex Espacos = new(@"[ \t ]+", RegexOptions.Compiled);
    static readonly Regex Linhas = new(@"\s*\n\s*", RegexOptions.Compiled);

    public static string HtmlParaTexto(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return "";
        var t = QuebraDeLinha.Replace(html, "\n");
        t = Tag.Replace(t, "");
        t = WebUtility.HtmlDecode(t);
        t = Espacos.Replace(t, " ");
        t = Linhas.Replace(t, "\n");
        return t.Trim();
    }
}
