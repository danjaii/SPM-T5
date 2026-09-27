import express from "express";

// Route registration follows the first failing ER-01 acceptance tests.
export function createApp(_options: unknown) {
  return express();
}
