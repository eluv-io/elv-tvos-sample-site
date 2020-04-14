
var Utils = require('./utils');
var URI = require("urijs");
var UrlJoin = require("url-join");

module.exports = class Site {
  constructor({fabric, siteId}) {
    this.fabric = fabric;
    this.client = fabric.client;
    this.siteId = siteId;
  }

  async loadSite() {
    try {
      const availableDRMS = await this.client.AvailableDRMs();
      this.dashSupported = availableDRMS.includes("widevine");

      this.siteLibraryId = await this.client.ContentObjectLibraryId({objectId: this.siteId});

      const siteName = await this.client.ContentObjectMetadata({
        libraryId: this.siteLibraryId,
        objectId: this.siteId,
        metadataSubtree: "public/name"
      });

      let siteInfo = await this.client.ContentObjectMetadata({
        libraryId: this.siteLibraryId,
        objectId: this.siteId,
        metadataSubtree: "public/asset_metadata",
        resolveLinks: true
      });

      siteInfo.name = siteName;

      siteInfo.baseLinkUrl = await this.client.LinkUrl({
        libraryId: this.siteLibraryId,
        objectId: this.siteId,
        linkPath: "public/asset_metadata"
      });

      siteInfo.title_logo = this.createLink(
        siteInfo.baseLinkUrl,
        "images/title_logo/thumbnail"
      );
      
      if(siteInfo.playlists) {
        siteInfo.playlists = await this.loadPlaylists(siteInfo.playlists);
      }

      // console.log('Site Playlists: ' + Utils.JQ(siteInfo.playlists));
      this.siteInfo = siteInfo;
      console.log("Site loaded successfully.");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to load site:");
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }

  async loadPlaylists(playlistInfo) {
    // Playlists: {[index]: {[playlist-name]: {[title-key]: { ...title }}}
    let playlists = [];
    await Promise.all(
      Object.keys(playlistInfo).map(async index => {
        try {
          const playlistName = Object.keys(playlistInfo[index])[0];
          const playlistIndex = parseInt(index);

          const playlistTitles = await Promise.all(
            Object.keys(playlistInfo[index][playlistName]).map(async (titleKey, titleIndex) => {
              try {
                let title = playlistInfo[index][playlistName][titleKey];

                title.baseLinkUrl =
                  await this.client.LinkUrl({
                    libraryId: this.siteLibraryId,
                    objectId: this.siteId,
                    linkPath: `public/asset_metadata/playlists/${index}/${playlistName}/${titleKey}`
                  });

                title.playoutOptionsLinkPath = `public/asset_metadata/playlists/${index}/${playlistName}/${titleKey}/sources/default`;

                title.playlistIndex = playlistIndex;
                title.titleIndex = titleIndex;

                title.posterUrl = this.createLink(
                  title.baseLinkUrl,
                  "images/main_slider_background_desktop/thumbnail"
                );

                title.playoutOptions = await this.client.PlayoutOptions({
                  libraryId: this.siteLibraryId,
                  objectId: this.siteId,
                  linkPath: title.playoutOptionsLinkPath,
                  protocols: ["hls", "dash"],
                  drms: ["aes-128", "widevine", "clear"]
                });

                const playoutUrl = (title.playoutOptions.hls.playoutMethods["aes-128"] || title.playoutOptions.hls.playoutMethods.clear).playoutUrl;

                title.videoUrl = playoutUrl;

                return title;
              } catch (error) {
                // eslint-disable-next-line no-console
                console.error(`Failed to load title ${titleIndex} (${titleKey}) in playlist ${index} (${playlistName})`);
                // eslint-disable-next-line no-console
                console.error(error);
              }
            })
          );

          playlists[playlistIndex] = {
            playlistIndex,
            name: playlistName,
            titles: playlistTitles.filter(title => title)
          };
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Failed to load playlist ${index}`);
          // eslint-disable-next-line no-console
          console.error(error);
        }
      })
    );

    return playlists.filter(playlist => playlist);
  }

  createLink(baseLink, path, query={}) {
    const basePath = URI(baseLink).path();

    return URI(baseLink)
      .path(UrlJoin(basePath, path))
      .addQuery(query)
      .toString();
  }
}