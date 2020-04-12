# Eluvio TVOS Sample App

This application displays a given Fabric Site Object using TVML templates on a Apple TV device.

## Development

### Clone project and install dependencies.

```
cd elv-tvos-sample-site/elv-tvos
npm install

```

### Edit config.json with your Fabric values.

```
{
  "configUrl": "https://[FABRIC_URL]/config",
  "siteId": "iq__xxxx"
}

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
