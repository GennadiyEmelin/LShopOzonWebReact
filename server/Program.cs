using LShopOzonWebReact.Api.Endpoints;
using LShopOzonWebReact.Api.Extensions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddApplicationServices(builder.Configuration);

var app = builder.Build();

await app.InitializeApplicationAsync();
app.UseApplicationPipeline();
app.MapAuthEndpoints();
app.MapProductionEndpoints();
app.MapProfileEndpoints();
app.MapAdminEndpoints();
app.MapSuppliesEndpoints();
app.MapChatEndpoints();
app.MapOzonEndpoints();
app.MapUtilityEndpoints();

var hasStaticClient = !string.IsNullOrWhiteSpace(app.Environment.WebRootPath)
    && Directory.Exists(app.Environment.WebRootPath);
if (hasStaticClient)
{
    app.MapFallbackToFile("index.html");
}

app.Run();
