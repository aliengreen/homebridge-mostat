# homebridge-mostat

#### Homebridge plugin to Mostat from homekit

## Installation

1. Install [homebridge](https://github.com/nfarina/homebridge#installation-details)
2. Install this plugin: `npm install -g homebridge-mostat`
3. Update your `config.json` file (See below).

## Configuration example

```json
"accessories": [
    {
        "accessory": "mostat",
        "name":"Mostat Loading…",
        "access_token": "bearer token",
        "device_uuid":"eui64"
    }
]
```
