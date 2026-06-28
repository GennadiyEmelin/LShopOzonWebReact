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
                </Relationships>
                """);
            WriteEntry(archive, "xl/workbook.xml", $"""
                <?xml version="1.0" encoding="UTF-8"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="{System.Security.SecurityElement.Escape(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets>
                </workbook>
                """);
            WriteEntry(archive, "xl/worksheets/sheet1.xml", CreateWorksheet(rows));
        }

        return memory.ToArray();
    }

    private static string CreateWorksheet(IReadOnlyList<string[]> rows)
    {
        var builder = new StringBuilder();
        builder.Append("""<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>""");
        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++)
        {
            builder.Append($"""<row r="{rowIndex + 1}">""");
            for (var columnIndex = 0; columnIndex < rows[rowIndex].Length; columnIndex++)
            {
                var cellRef = $"{ColumnName(columnIndex)}{rowIndex + 1}";
                var value = System.Security.SecurityElement.Escape(rows[rowIndex][columnIndex]) ?? string.Empty;
                builder.Append($"""<c r="{cellRef}" t="inlineStr"><is><t>{value}</t></is></c>""");
            }
            builder.Append("</row>");
        }
        builder.Append("</sheetData></worksheet>");
        return builder.ToString();
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
}



