using System.Security.Claims;
using LShopOzonWebReact.Api.Contracts.Common;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Endpoints;

public static class UtilityEndpoints
{
    private static readonly Product[] DemoProducts =
    [
        new Product(1, "Ozon карточка товара", "Готова к публикации", 1290),
        new Product(2, "Складской остаток", "12 единиц в наличии", 3490),
        new Product(3, "Заказ клиента", "Ожидает обработки", 780)
    ];

    public static void MapUtilityEndpoints(this WebApplication app)
    {
app.MapGet("/api/avatars/{fileName}", (string fileName, IWebHostEnvironment environment) =>
{
    if (fileName != Path.GetFileName(fileName))
    {
        return Results.BadRequest();
    }

    var avatarPath = Path.Combine(AppPaths.GetAvatarDirectory(environment), fileName);
    if (!System.IO.File.Exists(avatarPath))
    {
        return Results.NotFound();
    }

    var extension = Path.GetExtension(fileName).ToLowerInvariant();
    var contentType = extension switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        _ => "image/jpeg"
    };

    return Results.File(avatarPath, contentType);
});

app.MapGet("/api/products", async (AppDbContext db, ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Products))
    {
        return Results.Forbid();
    }

    return Results.Ok(DemoProducts);
})
    .WithName("GetProducts")
    .RequireAuthorization();

app.MapGet("/api/link-preview", async (string? url, IHttpClientFactory httpClientFactory, ClaimsPrincipal principal) =>
{
    if (principal.Identity?.IsAuthenticated != true)
    {
        return Results.Unauthorized();
    }

    if (!LinkPreviewHelper.TryNormalizeExternalUrl(url, out var normalizedUrl))
    {
        return Results.BadRequest("Invalid URL");
    }

    try
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(8);
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        client.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        using var response = await client.GetAsync(normalizedUrl);
        if (!response.IsSuccessStatusCode)
        {
            return Results.Ok(new LinkPreviewResponse(null, null));
        }

        var html = await response.Content.ReadAsStringAsync();
        if (html.Length > 512_000)
        {
            html = html[..512_000];
        }

        var imageUrl = LinkPreviewHelper.ExtractMetaContent(html, "og:image")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "og:image:secure_url")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "og:image:url")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "twitter:image")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "twitter:image:src")
            ?? LinkPreviewHelper.ExtractLinkHref(html, "image_src");
        imageUrl = LinkPreviewHelper.ResolveResourceUrl(normalizedUrl, imageUrl);
        var title = LinkPreviewHelper.ExtractMetaContent(html, "og:title")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "twitter:title");
        return Results.Ok(new LinkPreviewResponse(imageUrl, title));
    }
    catch
    {
        return Results.Ok(new LinkPreviewResponse(null, null));
    }
}).RequireAuthorization();

app.MapGet("/api/link-preview/image", async (string? url, IHttpClientFactory httpClientFactory, ClaimsPrincipal principal) =>
{
    if (principal.Identity?.IsAuthenticated != true)
    {
        return Results.Unauthorized();
    }

    if (!LinkPreviewHelper.TryNormalizeExternalUrl(url, out var normalizedUrl))
    {
        return Results.BadRequest("Invalid URL");
    }

    try
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(8);
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        client.DefaultRequestHeaders.Accept.ParseAdd("image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
        using var response = await client.GetAsync(normalizedUrl);
        if (!response.IsSuccessStatusCode)
        {
            return Results.NotFound();
        }

        var contentType = response.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
        if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return Results.NotFound();
        }

        var bytes = await response.Content.ReadAsByteArrayAsync();
        if (bytes.Length == 0 || bytes.Length > 5_000_000)
        {
            return Results.NotFound();
        }

        return Results.File(bytes, contentType);
    }
    catch
    {
        return Results.NotFound();
    }
}).RequireAuthorization();
    }
}
