using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using LShopOzonWebReact.Api.Contracts.Supplies;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Production;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Supplies;
static class SupplyAnalyticsHelper
{
    public static async Task<Dictionary<string, string>> BuildAcceptedSupplyArrivalDatesAsync(AppDbContext db)
    {
        var items = await (
            from item in db.SupplyItems.AsNoTracking()
            join supply in db.Supplies.AsNoTracking() on item.SupplyId equals supply.Id
            where !item.IsReserve &&
                  (supply.Status == SupplyStatuses.Accepted || supply.Status == SupplyStatuses.Sent)
            select new
            {
                item.OfferId,
                item.OzonProductId,
                SupplyDate = supply.AcceptedAt ?? supply.SentAt
            }).ToListAsync();

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items)
        {
            if (item.SupplyDate is null)
            {
                continue;
            }

            var date = item.SupplyDate.Value.ToString("yyyy-MM-dd");
            if (!string.IsNullOrWhiteSpace(item.OfferId))
            {
                var key = $"offer:{item.OfferId.Trim()}";
                if (!map.TryGetValue(key, out var existing) || string.Compare(date, existing, StringComparison.Ordinal) > 0)
                {
                    map[key] = date;
                }
            }

            if (item.OzonProductId is > 0)
            {
                var key = $"product:{item.OzonProductId.Value}";
                if (!map.TryGetValue(key, out var existing) || string.Compare(date, existing, StringComparison.Ordinal) > 0)
                {
                    map[key] = date;
                }
            }
        }

        return map;
    }
}

static class SupplyItemFactory
{
    public static SupplyItem Create(CreateSupplyItemRequest request)
    {
        var itemId = Guid.NewGuid();
        var isReserve = request.IsReserve;

        return new SupplyItem
        {
            Id = itemId,
            OzonProductId = isReserve ? null : request.OzonProductId,
            OfferId = isReserve
                ? NormalizeReserveOfferId(itemId, request.OfferId)
                : request.OfferId.Trim(),
            ProductName = request.ProductName.Trim(),
            Quantity = request.Quantity,
            IsReserve = isReserve
        };
    }

    public static string NormalizeReserveOfferId(Guid itemId, string? offerId)
    {
        var trimmed = offerId?.Trim() ?? string.Empty;
        return string.IsNullOrWhiteSpace(trimmed)
            ? ProductionTaskResponses.BuildNovinkaOfferId(itemId)
            : trimmed;
    }
}

static class ExcelSupplyImport
{
    private static readonly XNamespace Spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace Relationships = "http://schemas.openxmlformats.org/package/2006/relationships";

    public static byte[] CreateTemplate()
    {
        var rows = new[]
        {
            new[] { "Название товара", "Артикул", "ProductId", "Количество", "Новый товар" },
            new[] { "Пример постоянного товара", "OFFER-001", "123456789", "10", "нет" },
            new[] { "Пример нового товара", "", "", "5", "да" }
        };
        return ExcelExport.CreateWorkbook("Поставка", rows);
    }

    public static List<CreateSupplyItemRequest> ReadSupplyItems(Stream stream)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var sharedStrings = ReadSharedStrings(archive);
        var sheetEntry = archive.GetEntry("xl/worksheets/sheet1.xml")
            ?? throw new InvalidOperationException("В Excel-файле не найден первый лист.");

        using var sheetStream = sheetEntry.Open();
        var sheet = XDocument.Load(sheetStream);
        var rows = sheet.Descendants(Spreadsheet + "row")
            .Skip(1)
            .Select(row => ReadRow(row, sharedStrings))
            .Where(values => values.Any(value => !string.IsNullOrWhiteSpace(value)))
            .ToList();

        return rows.Select((values, index) =>
        {
            var productName = GetValue(values, 0);
            var offerId = GetValue(values, 1);
            var productIdText = GetValue(values, 2);
            var quantityText = GetValue(values, 3);
            var reserveText = GetValue(values, 4);

            if (!TryParseQuantity(quantityText, out var quantity))
            {
                throw new InvalidOperationException($"Строка {index + 2}: количество должно быть больше нуля.");
            }

            var isReserve = IsTrue(reserveText) || string.IsNullOrWhiteSpace(offerId);
            long? productId = long.TryParse(productIdText, out var parsedProductId) ? parsedProductId : null;

            if (!isReserve && string.IsNullOrWhiteSpace(offerId))
            {
                throw new InvalidOperationException($"Строка {index + 2}: для постоянного товара нужен артикул.");
            }

            return new CreateSupplyItemRequest(productId, offerId, productName, quantity, isReserve);
        }).ToList();
    }

    private static List<string> ReadSharedStrings(ZipArchive archive)
    {
        var entry = archive.GetEntry("xl/sharedStrings.xml");
        if (entry is null)
        {
            return [];
        }

        using var stream = entry.Open();
        var document = XDocument.Load(stream);
        return document.Descendants(Spreadsheet + "si")
            .Select(item => string.Concat(item.Descendants(Spreadsheet + "t").Select(text => text.Value)))
            .ToList();
    }

    private static List<string> ReadRow(XElement row, IReadOnlyList<string> sharedStrings)
    {
        var values = new List<string>();
        var nextImplicitColumn = 0;
        foreach (var cell in row.Elements(Spreadsheet + "c"))
        {
            var reference = cell.Attribute("r")?.Value;
            int index;
            if (string.IsNullOrWhiteSpace(reference))
            {
                index = nextImplicitColumn;
                nextImplicitColumn++;
            }
            else
            {
                index = ColumnIndex(reference);
                nextImplicitColumn = index + 1;
            }

            while (values.Count <= index)
            {
                values.Add(string.Empty);
            }

            values[index] = ReadCell(cell, sharedStrings);
        }

        return values;
    }

    private static string ReadCell(XElement cell, IReadOnlyList<string> sharedStrings)
    {
        var type = cell.Attribute("t")?.Value;
        if (type == "s")
        {
            var indexText = cell.Element(Spreadsheet + "v")?.Value ?? "0";
            return int.TryParse(indexText, out var index) && index >= 0 && index < sharedStrings.Count
                ? sharedStrings[index]
                : string.Empty;
        }

        if (type == "inlineStr")
        {
            return ReadInlineString(cell);
        }

        var valueElement = cell.Element(Spreadsheet + "v");
        if (valueElement != null && !string.IsNullOrEmpty(valueElement.Value))
        {
            return valueElement.Value;
        }

        if (cell.Element(Spreadsheet + "is") is not null)
        {
            return ReadInlineString(cell);
        }

        return string.Empty;
    }

    private static string ReadInlineString(XElement cell) =>
        string.Concat(cell.Descendants(Spreadsheet + "t").Select(text => text.Value));

    private static bool TryParseQuantity(string text, out int quantity)
    {
        quantity = 0;
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        text = text.Trim().Replace('\u00A0', ' ').Replace(" ", string.Empty);
        if (int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out quantity))
        {
            return quantity > 0;
        }

        if (double.TryParse(text.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var numeric))
        {
            quantity = (int)Math.Round(numeric, MidpointRounding.AwayFromZero);
            return quantity > 0;
        }

        return false;
    }

    private static string GetValue(IReadOnlyList<string> values, int index) =>
        index < values.Count ? values[index].Trim() : string.Empty;

    private static bool IsTrue(string value) =>
        value.Equals("да", StringComparison.OrdinalIgnoreCase)
        || value.Equals("true", StringComparison.OrdinalIgnoreCase)
        || value.Equals("1", StringComparison.OrdinalIgnoreCase);

    private static int ColumnIndex(string cellReference)
    {
        var letters = new string(cellReference.TakeWhile(char.IsLetter).ToArray());
        return letters.Aggregate(0, (sum, letter) => sum * 26 + letter - 'A' + 1) - 1;
    }
}

