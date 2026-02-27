import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getAllDevelopers } from "../db";

export function developersRoutes(db: Database) {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json(getAllDevelopers(db));
  });

  return app;
}
