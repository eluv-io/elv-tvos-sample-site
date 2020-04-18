
var {isEmpty} = require('./utils');
var URI = require("urijs");
var UrlJoin = require("url-join");

module.exports = class Site {
  constructor({fabric, siteId, hostTemplate="{{{host}}}"}) {
    this.fabric = fabric;
    this.client = fabric.client;
    this.siteId = siteId;
    this.hostTemplate = hostTemplate;
  }

  async loadSite() {
    try {

      if(!this.siteLibraryId){
        this.siteLibraryId = await this.client.ContentObjectLibraryId({objectId: this.siteId});
      }

      let siteInfo = await this.client.ContentObjectMetadata({
        libraryId: this.siteLibraryId,
        objectId: this.siteId,
        metadataSubtree: "public/asset_metadata",
        resolveLinks: true
      });

      siteInfo.baseLinkUrl = await this.client.LinkUrl({
        libraryId: this.siteLibraryId,
        objectId: this.siteId,
        linkPath: "public/asset_metadata"
      });

      siteInfo.title_logo = this.createLink(
        siteInfo.baseLinkUrl,
        "images/title_logo/thumbnail"
      );

      siteInfo.title_logo = this.replaceTemplate(siteInfo.title_logo)
      
      if(siteInfo.playlists) {
        siteInfo.playlists = await this.loadPlaylists(siteInfo.playlists);
      }

      this.siteInfo = siteInfo;
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

                title.posterUrl = this.replaceTemplate(title.posterUrl);

                title.playoutOptions = await this.client.PlayoutOptions({
                  libraryId: this.siteLibraryId,
                  objectId: this.siteId,
                  linkPath: title.playoutOptionsLinkPath,
                  protocols: ["hls", "dash"],
                  drms: ["aes-128", "widevine", "clear"]
                });

                let playoutUrl = (title.playoutOptions.hls.playoutMethods.clear || title.playoutOptions.hls.playoutMethods["aes-128"]).playoutUrl;
                playoutUrl = playoutUrl.replace(/player_profile=hls-js/,"player_profile=hls-js-2441");

                title.videoUrl = playoutUrl;
                title.videoUrl = this.replaceTemplate(title.videoUrl);


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

  replaceTemplate(string){
    if(!isEmpty(this.hostTemplate)){
      let url = new URI(string).host(this.hostTemplate).scheme('');
      //Removes the // at the beginning since we removed the scheme
      return url.href().substr(2);
    }

    return string;
  }
}