# Appium Grid Plugin · [![NPM Version](https://img.shields.io/npm/v/@dlenroc/appium-grid-plugin?cacheSeconds=86400)](https://www.npmjs.com/package/@dlenroc/appium-grid-plugin) ![Node.js Version](https://img.shields.io/node/v/@dlenroc/appium-grid-plugin)

A plugin that simplifies the attachment of Appium to Selenium Grid 4.

## Installation

```shell
appium plugin install --source npm @dlenroc/appium-grid-plugin
```

## Parameters

| Parameter                           | Default                 | Description              |
| ----------------------------------- | ----------------------- | ------------------------ |
| `--plugin-grid-external-url`        | `http://127.0.0.1:4723` | Node external URL        |
| `--plugin-grid-publish-events`      | `tcp://127.0.0.1:4443`  | Grid ZeroMQ PUB socket   |
| `--plugin-grid-registration-secret` | -                       | Node registration secret |
| `--plugin-grid-stereotype`          | `{}`                    | Node stereotype(s)       |

## Example

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
