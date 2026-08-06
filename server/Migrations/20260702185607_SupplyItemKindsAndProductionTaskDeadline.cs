using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class SupplyItemKindsAndProductionTaskDeadline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ItemKind",
                table: "SupplyItems",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DueAt",
                table: "ProductionTasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "OverdueNotifiedAt",
                table: "ProductionTasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SupplyItems_ItemKind",
                table: "SupplyItems",
                column: "ItemKind");

            migrationBuilder.CreateIndex(
                name: "IX_ProductionTasks_DueAt",
                table: "ProductionTasks",
                column: "DueAt");

            migrationBuilder.CreateIndex(
                name: "IX_ProductionTasks_OverdueNotifiedAt",
                table: "ProductionTasks",
                column: "OverdueNotifiedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SupplyItems_ItemKind",
                table: "SupplyItems");

            migrationBuilder.DropIndex(
                name: "IX_ProductionTasks_DueAt",
                table: "ProductionTasks");

            migrationBuilder.DropIndex(
                name: "IX_ProductionTasks_OverdueNotifiedAt",
                table: "ProductionTasks");

            migrationBuilder.DropColumn(
                name: "ItemKind",
                table: "SupplyItems");

            migrationBuilder.DropColumn(
                name: "DueAt",
                table: "ProductionTasks");

            migrationBuilder.DropColumn(
                name: "OverdueNotifiedAt",
                table: "ProductionTasks");
        }
    }
}
