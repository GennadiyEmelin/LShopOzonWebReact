using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProductionTaskItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProductionTaskItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductionTaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    OzonProductId = table.Column<long>(type: "bigint", nullable: false),
                    OfferId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ProductName = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    RequiredQuantity = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductionTaskItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProductionTaskItems_ProductionTasks_ProductionTaskId",
                        column: x => x.ProductionTaskId,
                        principalTable: "ProductionTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductionTaskItems_OfferId",
                table: "ProductionTaskItems",
                column: "OfferId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductionTaskItems_ProductionTaskId",
                table: "ProductionTaskItems",
                column: "ProductionTaskId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProductionTaskItems");
        }
    }
}
