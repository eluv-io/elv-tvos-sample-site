# Eluvio TVOS Sample App

This application displays a given Fabric Site Object using TVML templates on a Apple TV device.

## Development

### Clone project and install dependencies.

```
cd elv-tvos-sample-site/elv-tvos
npm install

```

### create and edit elv-tvos/config.json with your Fabric values.

```
{
  "configUrl": "[FABRIC_URL]/config",
  "siteId": "iq__xxxx",
  "server_port": 4001
}

```

### Edit Debug.xconfig and Release.xconfig with the server url.

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
