using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class RoleProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RoleProfiles",
                columns: table => new
                {
                    Role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    AllowedFeatures = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    HomeBlocksJson = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    CanChangeOtherUserPasswords = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoleProfiles", x => x.Role);
                });

            migrationBuilder.Sql("""
                UPDATE "Users"
                SET "Role" = 'Production'
                WHERE "Role" = 'User';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Users"
                SET "Role" = 'User'
                WHERE "Role" IN ('Production', 'Designer', 'Leadership');
                """);

            migrationBuilder.DropTable(
                name: "RoleProfiles");
        }
    }
}
