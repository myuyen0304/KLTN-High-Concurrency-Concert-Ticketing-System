import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url: 'postgresql://postgres:postgres@localhost:5432/concert_ticketing?schema=public',
  },
});
