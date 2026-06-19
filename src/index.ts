/**
 * Multi-Model Headroom Proxy v2.0.0
 * Entry point — imports and starts the proxy server
 */

import * as dotenv from "dotenv";
dotenv.config({ path: __dirname + "/../.env" });

import "./proxy";
