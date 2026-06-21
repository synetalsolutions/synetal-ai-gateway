/**
 * Synetal AI Gateway v2.4.0
 * Entry point — imports and starts the proxy server
 */

import * as dotenv from "dotenv";
dotenv.config({ path: __dirname + "/../.env" });

import "./proxy";
