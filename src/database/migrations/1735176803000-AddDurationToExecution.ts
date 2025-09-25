import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDurationToExecution1735176803000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add duration column
    await queryRunner.query(`
      ALTER TABLE "execution" 
      ADD COLUMN "duration" integer
    `);

    // Add phasesDuration column
    await queryRunner.query(`
      ALTER TABLE "execution" 
      ADD COLUMN "phasesDuration" jsonb
    `);

    // Add comments
    await queryRunner.query(`
      COMMENT ON COLUMN "execution"."duration" IS 'Execution duration in seconds'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "execution"."phasesDuration" IS 'Phase-wise duration breakdown'
    `);

    // Update existing executions with duration calculation
    await queryRunner.query(`
      UPDATE "execution"
      SET "duration" = EXTRACT(EPOCH FROM ("completedAt" - "startedAt"))::integer
      WHERE "completedAt" IS NOT NULL 
      AND "startedAt" IS NOT NULL
      AND "duration" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "execution" DROP COLUMN "phasesDuration"`,
    );
    await queryRunner.query(`ALTER TABLE "execution" DROP COLUMN "duration"`);
  }
}
