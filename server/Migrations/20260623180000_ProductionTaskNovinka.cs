using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProductionTaskNovinka : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TaskType",
                table: "ProductionTasks",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Ozon");

            migrationBuilder.AddColumn<string>(
                name: "ProductLink",
                table: "ProductionTaskItems",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ProductLink",
                table: "ProductionFiles",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TaskType",
                table: "ProductionTasks");

            migrationBuilder.DropColumn(
                name: "ProductLink",
                table: "ProductionTaskItems");

            migrationBuilder.DropColumn(
                name: "ProductLink",
                table: "ProductionFiles");
        }
    }
}
