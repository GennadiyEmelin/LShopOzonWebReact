using System.IO.Compression;
using System.Text;
using System.Xml.Linq;

static class ExcelExport
{
    private static readonly XNamespace Spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    public static byte[] CreateWorkbook(string sheetName, IReadOnlyList<string[]> rows)
    {
        var safeSheetName = string.IsNullOrWhiteSpace(sheetName) ? "Sheet1" : sheetName.Trim();
        if (safeSheetName.Length > 31)
        {
            safeSheetName = safeSheetName[..31];
        }

        using var memory = new MemoryStream();
        using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, true))
        {
            WriteEntry(archive, "[Content_Types].xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
                </Types>
                """);
            WriteEntry(archive, "_rels/.rels", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>
                """);
            WriteEntry(archive, "xl/_rels/workbook.xml.rels", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
                </Relationships>
                """);
            WriteEntry(archive, "xl/workbook.xml", $"""
                <?xml version="1.0" encoding="UTF-8"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="{System.Security.SecurityElement.Escape(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets>
                </workbook>
                """);
            WriteEntry(archive, "xl/styles.xml", CreateStyles());
            WriteEntry(archive, "xl/worksheets/sheet1.xml", CreateWorksheet(safeSheetName, rows));
        }

        return memory.ToArray();
    }

    private static string CreateWorksheet(string sheetName, IReadOnlyList<string[]> rows)
    {
        if (sheetName.Equals("Materials", StringComparison.OrdinalIgnoreCase))
        {
            return CreateMaterialsWorksheet(rows);
        }

        if (sheetName.Equals("Sales", StringComparison.OrdinalIgnoreCase))
        {
            return CreateSalesWorksheet(rows);
        }

        return CreatePlainWorksheet(rows);
    }

    private static string CreatePlainWorksheet(IReadOnlyList<string[]> rows)
    {
        var builder = new StringBuilder();
        builder.Append("""<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>""");
        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++)
        {
            builder.Append($"""<row r="{rowIndex + 1}">""");
            for (var columnIndex = 0; columnIndex < rows[rowIndex].Length; columnIndex++)
            {
                AppendCell(builder, rowIndex + 1, columnIndex, rows[rowIndex][columnIndex], 0);
            }
            builder.Append("</row>");
        }
        builder.Append("</sheetData></worksheet>");
        return builder.ToString();
    }

    private static string CreateMaterialsWorksheet(IReadOnlyList<string[]> rows)
    {
        var builder = new StringBuilder();
        var merges = new List<string>();
        var currentRow = 1;
        var title = rows.Count > 0 && rows[0].Length > 0 ? rows[0][0] : "Отчет материалов";
        var headers = rows.Count > 1 ? rows[1].Skip(1).ToArray() : Array.Empty<string>();
        var items = rows.Skip(2).Where(row => row.Length > 1).ToList();
        var belowNorm = items.Count(row => ReadNumber(row, 4) < 0);
        var requestTotal = items.Sum(row => ReadNumber(row, 6));
        var critical = items.Count(row => ReadNumber(row, 3) <= 0 || ReadNumber(row, 4) <= -Math.Max(1, ReadNumber(row, 2) / 2));

        builder.Append("""<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">""");
        builder.Append("""<cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="8" width="14" customWidth="1"/><col min="9" max="12" width="24" customWidth="1"/></cols>""");
        builder.Append("<sheetData>");

        AppendRow(builder, currentRow, [new(title, 1)]);
        merges.Add($"A{currentRow}:H{currentRow}");
        currentRow += 2;

        AppendRow(builder, currentRow, [
            new("Позиций", 6), new(items.Count.ToString(), 7),
            new("Ниже нормы", 6), new(belowNorm.ToString(), belowNorm > 0 ? 4 : 7),
            new("К заявке", 6), new(requestTotal.ToString("0"), 7),
            new("Критично", 6), new(critical.ToString(), critical > 0 ? 4 : 7),
        ]);
        currentRow += 2;

        foreach (var group in items.GroupBy(row => row.Length > 0 ? row[0] : "Без раздела"))
        {
            var groupRows = group.ToList();
            var groupBelowNorm = groupRows.Count(row => ReadNumber(row, 4) < 0);
            var groupRequest = groupRows.Sum(row => ReadNumber(row, 6));

            AppendRow(builder, currentRow, [new($"{group.Key}   |   позиций: {groupRows.Count}   |   ниже нормы: {groupBelowNorm}   |   к заявке: {groupRequest:0}", 2)]);
            merges.Add($"A{currentRow}:H{currentRow}");
            currentRow++;

            AppendRow(builder, currentRow, headers.Select(header => new StyledCell(header, 3)).ToArray());
            currentRow++;

            foreach (var row in groupRows)
            {
                var data = row.Skip(1).Select((cell, index) =>
                {
                    var sourceIndex = index + 1;
                    var style = sourceIndex == 4 && ReadNumber(row, sourceIndex) < 0
                        ? 4
                        : sourceIndex == 4 && ReadNumber(row, sourceIndex) > 0
                            ? 5
                            : 0;
                    return new StyledCell(cell, style);
                }).ToArray();
                AppendRow(builder, currentRow, data);
                currentRow++;
            }

            currentRow++;
        }

        builder.Append("</sheetData>");
        AppendMerges(builder, merges);
        builder.Append("""<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/></worksheet>""");
        return builder.ToString();
    }

    private static string CreateSalesWorksheet(IReadOnlyList<string[]> rows)
    {
        var builder = new StringBuilder();
        var merges = new List<string>();
        var currentRow = 1;
        var title = rows.Count > 0 && rows[0].Length > 0 ? rows[0][0] : "Отчет продаж";
        var tableRows = rows.Skip(2).TakeWhile(row => row.Length > 0).ToList();
        var summaryRows = rows.Skip(2 + tableRows.Count).Where(row => row.Length > 0).ToList();

        builder.Append("""<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">""");
        builder.Append("""<cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="5" width="16" customWidth="1"/></cols>""");
        builder.Append("<sheetData>");

        AppendRow(builder, currentRow, [new(title, 1)]);
        merges.Add($"A{currentRow}:E{currentRow}");
        currentRow += 2;

        AppendRow(builder, currentRow, rows.Count > 1 ? rows[1].Select(header => new StyledCell(header, 3)).ToArray() : Array.Empty<StyledCell>());
        currentRow++;
        foreach (var row in tableRows)
        {
            AppendRow(builder, currentRow, row.Select(cell => new StyledCell(cell, 0)).ToArray());
            currentRow++;
        }

        currentRow++;
        AppendRow(builder, currentRow, [new("Сводка", 2)]);
        merges.Add($"A{currentRow}:E{currentRow}");
        currentRow++;
        foreach (var row in summaryRows)
        {
            AppendRow(builder, currentRow, [
                new(row.ElementAtOrDefault(0) ?? string.Empty, 6),
                new(row.ElementAtOrDefault(1) ?? string.Empty, 7),
            ]);
            merges.Add($"B{currentRow}:E{currentRow}");
            currentRow++;
        }

        builder.Append("</sheetData>");
        AppendMerges(builder, merges);
        builder.Append("""<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/></worksheet>""");
        return builder.ToString();
    }

    private static void AppendRow(StringBuilder builder, int rowNumber, IReadOnlyList<StyledCell> cells)
    {
        builder.Append($"""<row r="{rowNumber}">""");
        for (var columnIndex = 0; columnIndex < cells.Count; columnIndex++)
        {
            AppendCell(builder, rowNumber, columnIndex, cells[columnIndex].Value, cells[columnIndex].Style);
        }
        builder.Append("</row>");
    }

    private static void AppendCell(StringBuilder builder, int rowNumber, int columnIndex, string? rawValue, int style)
    {
        var cellRef = $"{ColumnName(columnIndex)}{rowNumber}";
        var value = System.Security.SecurityElement.Escape(rawValue ?? string.Empty) ?? string.Empty;
        builder.Append($"""<c r="{cellRef}" s="{style}" t="inlineStr"><is><t>{value}</t></is></c>""");
    }

    private static void AppendMerges(StringBuilder builder, IReadOnlyList<string> merges)
    {
        if (merges.Count == 0)
        {
            return;
        }

        builder.Append($"""<mergeCells count="{merges.Count}">""");
        foreach (var merge in merges)
        {
            builder.Append($"""<mergeCell ref="{merge}"/>""");
        }
        builder.Append("</mergeCells>");
    }

    private static decimal ReadNumber(string[] row, int index)
    {
        if (index >= row.Length)
        {
            return 0;
        }

        var value = row[index].Replace(" ", string.Empty).Replace(',', '.');
        return decimal.TryParse(value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var result)
            ? result
            : 0;
    }

    private static string CreateStyles()
    {
        return """
            <?xml version="1.0" encoding="UTF-8"?>
            <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <fonts count="6">
                <font><sz val="11"/><name val="Calibri"/></font>
                <font><b/><sz val="16"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
                <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
                <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
                <font><b/><sz val="11"/><color rgb="FFDC2626"/><name val="Calibri"/></font>
                <font><b/><sz val="11"/><color rgb="FF047857"/><name val="Calibri"/></font>
              </fonts>
              <fills count="6">
                <fill><patternFill patternType="none"/></fill>
                <fill><patternFill patternType="gray125"/></fill>
                <fill><patternFill patternType="solid"><fgColor rgb="FF2F855A"/><bgColor indexed="64"/></patternFill></fill>
                <fill><patternFill patternType="solid"><fgColor rgb="FF22C55E"/><bgColor indexed="64"/></patternFill></fill>
                <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
                <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
              </fills>
              <borders count="2">
                <border><left/><right/><top/><bottom/><diagonal/></border>
                <border><left style="thin"><color rgb="FFD8E0EA"/></left><right style="thin"><color rgb="FFD8E0EA"/></right><top style="thin"><color rgb="FFD8E0EA"/></top><bottom style="thin"><color rgb="FFD8E0EA"/></bottom><diagonal/></border>
              </borders>
              <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
              <cellXfs count="8">
                <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
                <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>
                <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
                <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
                <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
                <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
                <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
                <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
              </cellXfs>
              <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
            </styleSheet>
            """;
    }

    private static void WriteEntry(ZipArchive archive, string path, string content)
    {
        var entry = archive.CreateEntry(path);
        using var writer = new StreamWriter(entry.Open(), Encoding.UTF8);
        writer.Write(content.Trim());
    }

    private static string ColumnName(int index)
    {
        var dividend = index + 1;
        var name = string.Empty;
        while (dividend > 0)
        {
            var modulo = (dividend - 1) % 26;
            name = Convert.ToChar('A' + modulo) + name;
            dividend = (dividend - modulo) / 26;
        }
        return name;
    }

    private readonly record struct StyledCell(string Value, int Style);
}



