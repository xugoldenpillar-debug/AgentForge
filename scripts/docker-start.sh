#!/bin/sh
set -eu
pnpm db
exec pnpm start --hostname 0.0.0.0
