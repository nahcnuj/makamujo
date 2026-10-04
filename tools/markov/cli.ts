#!/usr/bin/env bun
import { dispatch } from "./command";
import { markovCommands } from "./commands";

dispatch(markovCommands, Bun.argv.slice(2));
