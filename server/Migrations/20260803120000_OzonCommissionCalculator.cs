using System;
using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260803120000_OzonCommissionCalculator")]
    public partial class OzonCommissionCalculator : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OzonCommissionSnapshots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<long>(type: "bigint", nullable: false),
                    OfferId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ProductName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    DescriptionCategoryId = table.Column<long>(type: "bigint", nullable: true),
                    TypeId = table.Column<long>(type: "bigint", nullable: true),
                    SalesPercentFbo = table.Column<decimal>(type: "numeric", nullable: false),
                    SalesPercentFbs = table.Column<decimal>(type: "numeric", nullable: false),
                    FboFulfillmentAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FboDirectFlowTransMinAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FboDirectFlowTransMaxAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FboDelivToCustomerAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FboReturnFlowAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FbsFirstMileMinAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FbsFirstMileMaxAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FbsDirectFlowTransMinAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FbsDirectFlowTransMaxAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FbsDelivToCustomerAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    FbsReturnFlowAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    AcquiringPercent = table.Column<decimal>(type: "numeric", nullable: true),
                    CurrentPrice = table.Column<decimal>(type: "numeric", nullable: false),
                    OldPrice = table.Column<decimal>(type: "numeric", nullable: true),
                    MarketingPrice = table.Column<decimal>(type: "numeric", nullable: true),
                    MinPrice = table.Column<decimal>(type: "numeric", nullable: true),
                    CurrencyCode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    // Сырой JSON — колонка text без ограничения длины.
                    // Узкая колонка под JSON уже роняла старт приложения (коммит 0e1eb35).
                    RawCommissionsJson = table.Column<string>(type: "text", nullable: false),
                    FetchedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OzonCommissionSnapshots", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "OzonCategoryCommissions",
                columns: table => new
                {
                    DescriptionCategoryId = table.Column<long>(type: "bigint", nullable: false),
                    CategoryName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    AvgSalesPercentFbo = table.Column<decimal>(type: "numeric", nullable: false),
                    AvgSalesPercentFbs = table.Column<decimal>(type: "numeric", nullable: false),
                    SampleSize = table.Column<int>(type: "integer", nullable: false),
                    IsManualOverride = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OzonCategoryCommissions", x => x.DescriptionCategoryId);
                });

            migrationBuilder.CreateTable(
                name: "OzonCommissionSyncStates",
                columns: table => new
                {
                    Key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", nullable: false),
                    LastSyncStartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastSyncCompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    TotalProducts = table.Column<int>(type: "integer", nullable: false),
                    SyncedProducts = table.Column<int>(type: "integer", nullable: false),
                    ErrorMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OzonCommissionSyncStates", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "CalculatorSettings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AcquiringPercent = table.Column<decimal>(type: "numeric", nullable: false),
                    TaxMode = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    TaxPercent = table.Column<decimal>(type: "numeric", nullable: false),
                    BuyoutRatePercent = table.Column<decimal>(type: "numeric", nullable: false),
                    LogisticsRatePerLiter = table.Column<decimal>(type: "numeric", nullable: false),
                    LogisticsBaseAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    AdvertisingPercent = table.Column<decimal>(type: "numeric", nullable: false),
                    ExtraCostFixed = table.Column<decimal>(type: "numeric", nullable: false),
                    DefaultScheme = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CalculatorSettings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OzonCommissionSnapshots_ProductId",
                table: "OzonCommissionSnapshots",
                column: "ProductId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OzonCommissionSnapshots_DescriptionCategoryId",
                table: "OzonCommissionSnapshots",
                column: "DescriptionCategoryId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "OzonCommissionSnapshots");
            migrationBuilder.DropTable(name: "OzonCategoryCommissions");
            migrationBuilder.DropTable(name: "OzonCommissionSyncStates");
            migrationBuilder.DropTable(name: "CalculatorSettings");
        }
    }
}
