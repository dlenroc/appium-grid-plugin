# Appium Grid Plugin · [![NPM Version](https://img.shields.io/npm/v/@dlenroc/appium-grid-plugin?cacheSeconds=86400)](https://www.npmjs.com/package/@dlenroc/appium-grid-plugin) ![Node.js Version](https://img.shields.io/node/v/@dlenroc/appium-grid-plugin)

A plugin for registering Appium as a node in Selenium Grid 4.

## Installation

```shell
appium plugin install --source npm @dlenroc/appium-grid-plugin
```

## Parameters

| Parameter                        | Default                 | Description            |
| -------------------------------- | ----------------------- | ---------------------- |
| `--plugin-grid-external-url`     | `http://127.0.0.1:4723` | Node external URL      |
| `--plugin-grid-publish-events`   | `tcp://127.0.0.1:4443`  | Grid ZeroMQ PUB socket |
| `--plugin-grid-stereotype`       | `{}`                    | Node stereotype(s)     |
| `--plugin-grid-heartbeat-period` | `60000`                 | Heartbeat period (ms)  |
| `--plugin-grid-session-timeout`  | `300000`                | Session timeout (ms)   |

## Usage

Start the Selenium Grid Hub

```shell
selenium-server hub \
  --port 4444 \
  --host 127.0.0.1 \
  --publish-events 'tcp://127.0.0.1:4442' \
  --subscribe-events 'tcp://127.0.0.1:4443'
```

Start as many Appium nodes as needed

```shell
npx appium \
  --use-plugins grid \
  --plugin-grid-external-url 'http://127.0.0.1:4723' \
  --plugin-grid-publish-events 'tcp://127.0.0.1:4443' \
  --plugin-grid-stereotype '{ "platformName": "roku" }' \
  --default-capabilities '{
    "appium:automationName": "roku",
    "appium:ip": "<device-ip>",
    "appium:password": "<devmode-password>"
  }'
```
