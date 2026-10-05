#!/bin/sh

# Bind to every interface so the dev server is reachable from outside a container,
# which is the only reason this script exists rather than `npm run dev`.
npm run dev -- --host 0.0.0.0
