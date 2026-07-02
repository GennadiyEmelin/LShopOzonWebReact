using System.Text.Json;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;

namespace LShopOzonWebReact.Api.Marketplaces;

internal static class SatuProductMapper
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    internal static SatuProduct MapFromJson(JsonElement item, string shopId, DateTimeOffset syncedAt)
    {
        var sku = SatuApiClient.ReadString(item, "sku") ?? SatuApiClient.ReadString(item, "external_id") ?? string.Empty;
        var productId = SatuApiClient.ReadLong(item, "id") ?? 0;
        var name = SatuApiClient.ReadString(item, "name") ?? sku;
        var imageUrl = SatuApiClient.ReadString(item, "main_image") ?? string.Empty;
        var imageUrls = new List<string>();

        if (!string.IsNullOrWhiteSpace(imageUrl))
        {
            imageUrls.Add(imageUrl);
        }

        if (item.TryGetProperty("images", out var images) && images.ValueKind == JsonValueKind.Array)
        {
            foreach (var image in images.EnumerateArray())
            {
                var url = SatuApiClient.ReadString(image, "url", "thumbnail_url") ?? string.Empty;
                if (!string.IsNullOrWhiteSpace(url) && !imageUrls.Contains(url, StringComparer.OrdinalIgnoreCase))
                {
                    imageUrls.Add(url);
                    if (string.IsNullOrWhiteSpace(imageUrl))
                    {
                        imageUrl = url;
                    }
                }
            }
        }

        var productUrl = SatuApiClient.ReadString(item, "url") ??
                         (productId > 0 ? $"https://satu.kz/p/{productId}" : string.Empty);

        return new SatuProduct
        {
            Id = Guid.NewGuid(),
            SatuProductId = productId,
            ShopId = shopId,
            OfferId = string.IsNullOrWhiteSpace(sku) ? $"item-{productId}" : sku,
            Name = name,
            Price = SatuApiClient.ReadDecimal(item, "price"),
            OldPrice = SatuApiClient.ReadDecimal(item, "discount", "old_price", "previous_price"),
            Stock = (int)Math.Clamp(SatuApiClient.ReadDecimal(item, "quantity", "stock", "in_stock"), 0, int.MaxValue),
            Description = SatuApiClient.ReadString(item, "description") ?? string.Empty,
            CategoryId = SatuApiClient.ReadString(item, "category_id", "group_id", "category"),
            ImageUrlsJson = JsonSerializer.Serialize(imageUrls, JsonOptions),
            Status = SatuApiClient.NormalizeCatalogStatus(item),
            ProductUrl = productUrl,
            ImageUrl = imageUrl,
            CurrencyCode = SatuApiClient.ReadString(item, "currency") ?? "KZT",
            IsActive = true,
            LastSyncedAt = syncedAt,
            ExternalUpdatedAt = ReadExternalUpdatedAt(item),
            RawJson = item.GetRawText()
        };
    }

    internal static OzonProductSummary ToSummary(SatuProduct product) =>
        new(
            product.SatuProductId,
            product.OfferId,
            product.SatuProductId,
            product.Name,
            product.Price,
            product.OldPrice,
            0,
            product.CurrencyCode,
            product.Status,
            product.ProductUrl,
            product.ImageUrl);

    internal static void ApplyJson(SatuProduct target, JsonElement item, DateTimeOffset syncedAt)
    {
        var mapped = MapFromJson(item, target.ShopId, syncedAt);
        target.OfferId = mapped.OfferId;
        target.Name = mapped.Name;
        target.Price = mapped.Price;
        target.OldPrice = mapped.OldPrice;
        target.Stock = mapped.Stock;
        target.Description = mapped.Description;
        target.CategoryId = mapped.CategoryId;
        target.ImageUrlsJson = mapped.ImageUrlsJson;
        target.Status = mapped.Status;
        target.ProductUrl = mapped.ProductUrl;
        target.ImageUrl = mapped.ImageUrl;
        target.CurrencyCode = mapped.CurrencyCode;
        target.IsActive = true;
        target.LastSyncedAt = syncedAt;
        target.ExternalUpdatedAt = mapped.ExternalUpdatedAt;
        target.RawJson = mapped.RawJson;
    }

    private static DateTimeOffset? ReadExternalUpdatedAt(JsonElement item)
    {
        foreach (var name in new[] { "updated_at", "date_modified", "modified_at", "last_update" })
        {
            var value = SatuApiClient.ReadString(item, name);
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            if (DateTimeOffset.TryParse(value, out var parsed))
            {
                return parsed.ToUniversalTime();
            }
        }

        return null;
    }
}
