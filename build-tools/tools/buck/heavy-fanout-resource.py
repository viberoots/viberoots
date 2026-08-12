#!/usr/bin/env python3
import json

print(json.dumps({"resources": [{"permit": "viberoots-heavy-fanout"}]}, separators=(",", ":")))
