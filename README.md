# Acervo Digital · Livraria do Senado (protótipo)

Aplicativo para celular que reúne as obras que a [Livraria do Senado Federal](https://livraria.senado.leg.br/)
oferece gratuitamente em formato digital (PDF e EPUB). O usuário busca, filtra por categoria, vê a ficha da
obra e abre o arquivo direto no celular. É um protótipo para apresentação interna.

Na coleta de 06/11/2026: **499 obras gratuitas** a partir dos 614 títulos da loja.

## O que tem nesta pasta

| Pasta | O que é |
|---|---|
| `app/` | O aplicativo: um app web instalável (PWA) em HTML, CSS e JavaScript puros, sem etapa de build. |
| `app/data/catalogo.json` | O catálogo de obras, gerado pelo coletor. É o único dado que o app lê. |
| `coletor/` | Script que monta o catálogo a partir do site da Livraria. Grava também `ultima-coleta.txt`, um relatório do que ficou de fora. |
| `servidor/` | Servidor local para demonstrar o app no computador ou no celular. |
| `.github/workflows/` | Publicação automática da pasta `app/` no GitHub Pages (HTTPS). |
| `app/baixar/` | O APK do app Android, baixável pelo site. |
| `pacote-android/` | Só neste computador (fora do Git): chave de assinatura e pacote para a Play Store. |

Requisito único: [.NET 10 SDK](https://dotnet.microsoft.com/download) (os scripts `.cs` rodam direto, sem projeto).

## Como usar

Na pasta do projeto:

```bash
dotnet run servidor/servidor.cs
```

Abra http://localhost:8080. Para abrir no **celular** (mesma rede Wi-Fi):

```bash
dotnet run servidor/servidor.cs -- --rede
```

O terminal mostra o endereço para digitar no celular (ex.: `http://192.168.0.10:8080`). Na primeira vez o
Windows pode pedir permissão no firewall.

Para **atualizar o catálogo** (leva uns 5 minutos):

```bash
dotnet run coletor/coletor.cs
```

Opções úteis: `-- --limite 20` (teste rápido), `-- --paralelo 2 --pausa 500` (mais devagar).

## Publicar em HTTPS

O celular só oferece **Instalar** e só liga o modo offline quando o app está em HTTPS. O app é só a
pasta `app/` (arquivos estáticos, caminhos relativos), então qualquer hospedagem de site estático serve,
inclusive dentro de uma subpasta. Enquanto for protótipo, ele aparece com o selo "protótipo" e pede aos
buscadores para não ser indexado (`noindex`).

**Link temporário (para mostrar na hora, sem conta):** com o servidor local rodando, um túnel da
Cloudflare gera um endereço `https://….trycloudflare.com` que abre em qualquer celular, mesmo fora da
rede. O link vale enquanto o computador e o túnel estiverem ligados, e muda a cada vez.

```bash
winget install --id Cloudflare.cloudflared
```

```bash
cloudflared tunnel --url http://localhost:8080
```

**Endereço fixo no GitHub Pages (gratuito):** o fluxo `.github/workflows/publicar.yml` publica a pasta
`app/` a cada envio para a branch `main`.

1. Crie um repositório **público** no GitHub (ex.: `acervo-senado`). No plano gratuito, o Pages exige
   repositório público.
2. No repositório: *Settings › Pages › Source*: **GitHub Actions**.
3. Na pasta do projeto, envie o código (na primeira vez o Git abre o navegador para entrar no GitHub):

```bash
git init -b main && git add . && git commit -m "Protótipo do Acervo Digital"
```

```bash
git remote add origin https://github.com/SEU-USUARIO/acervo-senado.git && git push -u origin main
```

Em 1 ou 2 minutos o app fica em `https://SEU-USUARIO.github.io/acervo-senado/`. Para atualizar o
catálogo, rode o coletor e envie de novo (`git commit -am "Atualiza catálogo" && git push`).

**Versão oficial:** copiar a pasta `app/` para um servidor web do Senado com HTTPS. Não precisa de
banco de dados nem de código no servidor.

## App Android (APK)

Download: **https://xeldon.github.io/acervo-digital/baixar/acervo-digital.apk** (cerca de 1 MB, Android 7 ou
mais novo). Para instalar, o Android pede para permitir "instalar apps desta fonte".

- **Como foi gerado:** pelo serviço gratuito do [PWABuilder](https://www.pwabuilder.com/) (Microsoft), a
  partir do site publicado. É um app Android do tipo TWA: uma "casca" que abre o site no motor do Chrome, em
  tela cheia. Pacote `io.github.xeldon.acervodigital`, versão 0.1.0 (código 1).
- **Atualizações do site chegam sozinhas ao APK**, porque ele abre o site publicado. Só é preciso gerar um
  APK novo para mudar o nome, o ícone ou as cores do app.
- **Chave de assinatura:** está em `pacote-android/` (fora do Git, nunca publicar), junto com o `.aab` para
  a Play Store e o arquivo com as senhas. Guarde uma cópia em lugar seguro: as próximas versões do APK
  precisam ser assinadas com a mesma chave. A chave foi gerada pelo serviço do PWABuilder; para a versão
  oficial, o Senado deve gerar a própria chave.
- **Barra de endereço no topo:** aparece até o domínio confirmar que o app é dele. Para tirar, criar o
  repositório público `xeldon.github.io` com o arquivo `.well-known/assetlinks.json` (cópia em
  `pacote-android/conteudo/assetlinks.json`) e um arquivo vazio `.nojekyll`.
- **Gerar de novo** (nova versão): em pwabuilder.com, informar o endereço do app, *Package for stores ›
  Android*, aumentar a versão e escolher *Use mine* com a chave de `pacote-android/`.

## O que o app faz

- **Acervo**: busca por título, autor, assunto ou ISBN (ignora acentos e maiúsculas), filtros por categoria e
  formato, ordenação por título ou ano, vitrines de Destaques e Lançamentos (curadoria da própria loja).
- **Página da obra**: capa, ficha técnica, descrição, botões *Ler PDF* / *Baixar EPUB* / *Abrir na Biblioteca
  Digital*, compartilhar, preço do impresso com link para compra, obras relacionadas.
- **Estante**: obras salvas e histórico do que foi aberto, guardados no próprio aparelho.
- **Instalável**: ícone na tela inicial, abre em tela cheia e funciona offline para navegar no catálogo
  (exige HTTPS, ver *Limitações*).
- Modo escuro automático, layout para celular, tablet e computador, navegação por teclado.

## De onde vêm os dados

1. **Lista de obras**: API pública do WooCommerce da loja
   (`/wp-json/wc/store/v1/products`), com título, capa, descrição, categorias, autor, ano, ISBN e preço.
2. **Links dos arquivos**: não estão na API. O coletor abre a página de cada produto e lê o bloco
   *"Versão digital gratuita"* (botões `lv-dl-btn--pdf`, `--epub` e `--pagina`).
3. **Reserva**: o atributo de produto `LINK PDF` (presente em ~430 obras) é usado quando a página não mostra
   o bloco. Na coleta, ele bateu 100% com os links das páginas.
4. **Limpeza**: categorias genéricas ("Livros") saem; duplicadas são unificadas ("Legislação" existe duas
   vezes, "Constituição" e "Constituição Federal"); categorias com menos de 3 obras viram *assuntos* da obra.

O coletor se identifica (`User-Agent: LivrariaSenadoApp-Prototipo/0.1`), abre no máximo 3 páginas por vez com
pausa entre elas, e não baixa nenhum PDF.

## Limitações conhecidas

- **O PDF abre fora do app**, numa nova aba, no leitor de PDF do navegador. O servidor de arquivos
  (`www2.senado.leg.br/bdsf`) tem uma verificação anti-robô, não permite ser exibido dentro de outra página
  (`X-Frame-Options: SAMEORIGIN`) e não libera acesso a partir de outros domínios (CORS). Para uma pessoa
  funciona (a verificação passa sozinha em segundos), mas um leitor embutido no app depende da TI (ver abaixo).
- **A verificação de segurança vale por arquivo**: cada PDF aberto pela primeira vez passa pela tela
  "Verificação de segurança — Conexão verificada" antes de abrir.
- **Navegador sem leitor de PDF** (como o navegador embutido do app Claude, ou celulares Android antigos):
  o servidor entrega o PDF para exibição (`Content-Type: application/pdf`, sem forçar download), mas o
  navegador oferece o download. Se o download for cancelado, a aba fica parada em "Conexão verificada",
  porque o redirecionamento era o próprio PDF. Em Chrome, Edge e Safari o PDF abre direto. O app avisa o
  usuário sobre isso ao tocar em *Ler PDF*.
- **PDFs grandes são baixados em vez de abrir no navegador**, inclusive no Chrome do celular. Exemplo:
  *Autobiografia: Visconde de Mauá* (20,7 MB) baixa; *Autobiografia de C. B. Ottoni* (1,8 MB), o CPC
  (2,6 MB) e o Código Civil (3,2 MB) abrem. Causa provável: a BDSF roda em DSpace, que por padrão envia
  arquivos acima de 8 MB com `Content-Disposition: attachment` (configuração
  `content_disposition_threshold`). Não deu para confirmar pelo cabeçalho, porque a verificação anti-robô
  bloqueia consultas automáticas, inclusive OAI-PMH, REST e METS. O arquivo vai para *Downloads* e abre pela
  notificação de download. Se o Chrome perguntar "baixar novamente?", é porque o arquivo já está lá.
  - O app não tem como resolver isso sozinho. Um intermediário (proxy, cópia dos arquivos ou visualizador
    externo como o do Google) precisaria passar pela verificação de forma automatizada.
  - Também não dá para avisar antes quais obras serão baixadas: nem a Livraria nem o coletor têm acesso ao
    tamanho dos arquivos.
- **Instalar e usar offline exige HTTPS.** Pela rede local (`http://192.168...`) o app funciona, mas o
  celular não oferece a instalação. Ver *Publicar em HTTPS*.
- **O catálogo é um retrato** do momento da coleta. É preciso rodar o coletor de tempos em tempos.
- As capas vêm direto do site da Livraria.

## Próximos passos sugeridos (desenvolvimento interno)

1. **Fonte de dados oficial**: expor na API REST o campo customizado (ACF) que guarda o link digital
   (`show_in_rest`) ou padronizar o atributo `LINK PDF` em todos os produtos. Aí o app lê a API direto, sem
   raspar páginas, e fica sempre atualizado.
2. **PDFs grandes abrindo no navegador**: na BDSF, aumentar ou desligar o limite
   `xmlui.content_disposition_threshold` no `dspace.cfg`. Pelo visual da página, a BDSF usa a interface
   XMLUI; na JSPUI o nome é `webui.content_disposition_threshold`. Com isso todo PDF abre na tela, de
   qualquer tamanho. É uma linha de configuração. Junto, informar o tamanho de cada arquivo (o DSpace já
   guarda) para o app mostrar "PDF · 20,7 MB" e avisar quem usa o plano de dados do celular.
3. **Leitor dentro do app**: liberar CORS para o domínio do app nos arquivos da BDSF (e uma exceção na
   verificação anti-robô). Isso permite um leitor embutido (PDF.js / leitor EPUB) com marcador de página,
   ajuste de fonte, modo noturno e leitura offline das obras baixadas. Mesmo sem o leitor embutido, fazer a
   liberação da verificação valer para o site todo (e não por arquivo) já tira a tela de espera de cada PDF.
4. **Publicação**: hospedar em HTTPS num domínio do Senado. Para as lojas (Play Store / App Store),
   empacotar o mesmo código com Capacitor ou TWA, ou reescrever em React Native/Flutter usando o mesmo
   catálogo.
5. **Dados extras** que a TI pode fornecer: tamanho do arquivo, nº de páginas, sumário, data de atualização
   e número de downloads (para uma vitrine "Mais baixados").
6. **Ajustes no cadastro da loja** encontrados na coleta: produto com link só no atributo
   ("Aliança dos Povos da Floresta"), categorias duplicadas, categorias que são assuntos (algumas com erro
   de digitação, como "Representação Proporcioanal" e "Desenvolvimento sutentável"), atributos com nomes
   diferentes ("Ano"/"ANO", "Edição"/"EDIÇÃO") e valores trocados (em "A Vida de Luiz Viana Filho" o campo
   Ano contém o nome do autor). A lista de produtos sem versão digital está em `coletor/ultima-coleta.txt`.
