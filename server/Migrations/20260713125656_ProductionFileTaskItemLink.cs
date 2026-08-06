using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProductionFileTaskItemLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ProductionTaskItemId",
                table: "ProductionFiles",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProductionFiles_ProductionTaskItemId",
                table: "ProductionFiles",
                column: "ProductionTaskItemId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ProductionFiles_ProductionTaskItemId",
                table: "ProductionFiles");

            migrationBuilder.DropColumn(
                name: "ProductionTaskItemId",
                table: "ProductionFiles");
        }
    }
}
