import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

config();

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/otto',
  entities: ['src/database/entities/*.entity.ts'],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  logging: true,
});

async function runMigrations() {
  try {
    console.log('🔄 Initializing database connection...');
    await AppDataSource.initialize();

    console.log('🔍 Checking for schema changes...');

    // Production에서는 synchronize를 사용하되, 안전하게 처리
    if (process.env.NODE_ENV === 'production') {
      // 스키마 동기화 (ALTER TABLE 등 자동 실행)
      await AppDataSource.synchronize();
      console.log('✅ Database schema synchronized successfully!');
    }

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();