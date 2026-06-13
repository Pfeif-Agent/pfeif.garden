// Typed accessor for the 104-match fixtures graph.
import raw from "../../data/fixtures.json";
import type { Fixture } from "./types";

export const FIXTURES: Fixture[] = raw as Fixture[];
export const FIXTURE_BY_NUM: Record<number, Fixture> = Object.fromEntries(
  FIXTURES.map((m) => [m.num, m]),
);
