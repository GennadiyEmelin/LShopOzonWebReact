using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260702100000_ProductionAnalyticsItemsJsonText")]
    /// <inheritdoc />
    public partial class ProductionAnalyticsItemsJsonText : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "ItemsJson",
                table: "ProductionAnalyticsTaskRecords",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(8000)",
                oldMaxLength: 8000);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "ItemsJson",
                table: "ProductionAnalyticsTaskRecords",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");
        }
    }
}
