import { DataSource } from 'typeorm';
import { ExecutionSeeder } from './execution.seeder';
import { LogSeeder } from './log.seeder';
import * as dotenv from 'dotenv';

dotenv.config();

async function runSeeders() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'otto_db',
    entities: ['src/database/entities/*.entity.ts'],
    synchronize: false,
  });

  try {
    await dataSource.initialize();
    console.log('📊 Database connection established');

    // Run seeders in order
    console.log('🌱 Running seeders...');

    const executionSeeder = new ExecutionSeeder(dataSource);
    await executionSeeder.run();

    const logSeeder = new LogSeeder(dataSource);
    await logSeeder.run();

    console.log('✅ All seeders completed successfully');
  } catch (error: unknown) {
    console.error('❌ Error running seeders:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
    console.log('👋 Database connection closed');
  }
}

// Run if called directly
if (require.main === module) {
  void runSeeders();
}

export { runSeeders };
