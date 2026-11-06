// Servidor local para demonstrar o app (requer .NET 10).
//
// Uso (na pasta do projeto):
//   dotnet run servidor/servidor.cs                 -> só neste computador, porta 8080
//   dotnet run servidor/servidor.cs -- --rede       -> também para celulares na mesma rede Wi-Fi
//   dotnet run servidor/servidor.cs -- --porta 5000
//
// Com --rede o Windows pode pedir permissão no firewall na primeira vez.
// Observação: para "instalar" o app no celular e usar offline, ele precisa estar em HTTPS
// (servidor interno do Senado, GitHub Pages etc.). Pela rede local (http) ele funciona normalmente,
// só não oferece a instalação.

#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false

using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.StaticFiles;

var naRede = args.Contains("--rede");
var iPorta = Array.IndexOf(args, "--porta");
var porta = iPorta >= 0 && iPorta + 1 < args.Length && int.TryParse(args[iPorta + 1], out var p) ? p : 8080;
var pastaApp = Path.GetFullPath(Path.Combine(PastaDoScript(), "..", "app"));

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { WebRootPath = pastaApp, ContentRootPath = pastaApp });
builder.WebHost.UseUrls(naRede ? $"http://0.0.0.0:{porta}" : $"http://localhost:{porta}");
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.AddResponseCompression();

var app = builder.Build();
app.UseResponseCompression();

var tipos = new FileExtensionContentTypeProvider();
tipos.Mappings[".webmanifest"] = "application/manifest+json";
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = tipos,
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});

app.Lifetime.ApplicationStarted.Register(() =>
{
    Console.WriteLine("Acervo Digital no ar:");
    Console.WriteLine($"  Neste computador: http://localhost:{porta}");
    if (naRede)
        foreach (var ip in IpsDaRede()) Console.WriteLine($"  No celular (mesma rede Wi-Fi): http://{ip}:{porta}");
    else
        Console.WriteLine("  Para abrir no celular, rode com: dotnet run servidor/servidor.cs -- --rede");
    Console.WriteLine("Ctrl+C para parar.");
});

app.Run();

static IEnumerable<string> IpsDaRede() =>
    NetworkInterface.GetAllNetworkInterfaces()
        .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
        .SelectMany(n => n.GetIPProperties().UnicastAddresses)
        .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork)
        .Select(a => a.Address.ToString())
        .Distinct();

static string PastaDoScript([CallerFilePath] string caminho = "") => Path.GetDirectoryName(caminho)!;
