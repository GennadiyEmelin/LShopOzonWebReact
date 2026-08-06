using System;
using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260722120000_ProductCostTypes")]
    public partial class ProductCostTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CostTypeId",
                table: "ProductCostProfiles",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "UseIndividualCost",
                table: "ProductCostProfiles",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "ProductCostTypes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Marketplace = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    IsPurchased = table.Column<bool>(type: "boolean", nullable: false),
                    PurchaseCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    PackagingCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    ProductionCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductCostTypes", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductCostProfiles_CostTypeId",
                table: "ProductCostProfiles",
                column: "CostTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductCostTypes_Marketplace_Name",
                table: "ProductCostTypes",
                columns: new[] { "Marketplace", "Name" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ProductCostProfiles_ProductCostTypes_CostTypeId",
                table: "ProductCostProfiles",
                column: "CostTypeId",
                principalTable: "ProductCostTypes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProductCostProfiles_ProductCostTypes_CostTypeId",
                table: "ProductCostProfiles");

            migrationBuilder.DropTable(
                name: "ProductCostTypes");

            migrationBuilder.DropIndex(
                name: "IX_ProductCostProfiles_CostTypeId",
                table: "ProductCostProfiles");

            migrationBuilder.DropColumn(
                name: "CostTypeId",
                table: "ProductCostProfiles");

            migrationBuilder.DropColumn(
                name: "UseIndividualCost",
                table: "ProductCostProfiles");
        }
    }
}
