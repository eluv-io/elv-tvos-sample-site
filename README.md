# Eluvio TVOS Sample App

This application displays a given Fabric Site Object using TVML templates on a Apple TV device.

## Development

### Clone project and install dependencies.

```
cd elv-tvos-sample-site/elv-tvos
npm install

```

### Configuration

Create elv-tvos/config.json with your configuration values.

```
{
  "configUrl": "https://main.net955305.contentfabric.io/config",
  "siteSelectorId": "iq__xxxx",
  "serverPort": 4001,
  "serverHost": "http://127.0.0.1",
  "updateInterval": 60000
}

```

- configUrl - The url to the Fabric you would like to use. The above example is the main production Fabric.
- siteSelectorId - The site selector object id for your organization. This can be created with our creator tools.
- serverPort - The port this server will run.
- serverHost - The full domain where this server will be deployed.
- updateInterval - The interval for refreshing content in milliseconds.

### Edit Debug.xconfig and Release.xconfig with the server url including port.

```
# DEBUG
TV_BASE_URL = http:\/\/localhost:4001\/

```

### Start server inside elv-tvos folder.

```
npm start
```

### Open Project in Xcode and run in simulator

```
elv-tvos-sample-site/elv-tvos.xcodeproj
```

- Install any required packages Xcode prompts.
- Build and Run (Play button).
