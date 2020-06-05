
var {isEmpty, JQ} = require('./utils');
var URI = require("urijs");
var UrlJoin = require("url-join");
var Id = require("@eluvio/elv-client-js/src/Id");

module.exports = class Site {
  constructor({fabric, siteId, hostTemplate="{{{host}}}"}, videoQueryTemplate="{{params}}") {
    this.fabric = fabric;
    this.client = fabric.client;
    this.siteId = siteId;
    this.hostTemplate = hostTemplate;
    this.videoQueryTemplate = videoQueryTemplate;
  }

  async loadSite() {
    try {

      if(!this.siteLibraryId){
        this.siteLibraryId = await this.client.ContentObjectLibraryId({objectId: this.siteId});
      }

      const versionHash = await this.client.LatestVersionHash({objectId: this.siteId});

      let siteInfo = await this.client.ContentObjectMetadata({
        libraryId: this.siteLibraryId,
        objectId: this.siteId,
        metadataSubtree: "public/asset_metadata",
        resolveLinks: true,
        resolveIncludeSource: true,
        resolveIgnoreErrors: true,
        /*
        select: [
          "title",
          "display_title",
          "channels",
          "episodes",
          "playlists",
          "seasons",
          "series",
          "titles",
          "images"
        ]
        */
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

      siteInfo.landscape_logo = this.createLink(
        siteInfo.baseLinkUrl,
        "images/landscape/default"
      );

      siteInfo.landscape_logo = this.replaceTemplate(siteInfo.landscape_logo)
      
      if(siteInfo.playlists) {
        siteInfo.playlists = await this.loadPlaylists(versionHash, siteInfo.playlists);
      }

      this.siteInfo = siteInfo;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to load site:");
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }

  async loadPlaylists(versionHash, playlistInfo) {
    if(!playlistInfo || Object.keys(playlistInfo).length === 0) { return []; }
    let playlists = [];

    await Promise.all(
      Object.keys(playlistInfo).map(async playlistSlug => {
        try {
          const {name, order, list} = playlistInfo[playlistSlug];

          let titles = [];
          await Promise.all(
            Object.keys(list || {}).map(async titleSlug => {
              try {
                let title = list[titleSlug];

                title.displayTitle = title.display_title || title.title || "";
                title.versionHash = title["."].source;
                title.objectId = this.client.utils.DecodeVersionHash(title.versionHash).objectId;

                const titleLinkPath = `public/asset_metadata/playlists/${playlistSlug}/list/${titleSlug}`;
                title.baseLinkPath = titleLinkPath;
                title.baseLinkUrl =
                  await this.client.LinkUrl({versionHash, linkPath: titleLinkPath});

                let availableOfferings = await this.client.AvailableOfferings({versionHash: title.versionHash});

                //XXX: for testing
                availableOfferings.test = availableOfferings.default;
                title.availableOfferings = availableOfferings;

                console.log(title.displayTitle + " " + title.versionHash);
                console.log("Offerings: " + JQ(availableOfferings));

                title.playoutOptionsLinkPath = UrlJoin(titleLinkPath, "sources", "default");

                title.playoutOptions = await this.client.PlayoutOptions({
                  libraryId: this.siteLibraryId,
                  objectId: this.siteId,
                  linkPath: title.playoutOptionsLinkPath,
                  protocols: ["hls", "dash"],
                  drms: ["aes-128", "widevine", "clear"]
                });

                let playoutUrl = (title.playoutOptions.hls.playoutMethods.clear || title.playoutOptions.hls.playoutMethods["aes-128"]).playoutUrl;
                //playoutUrl = playoutUrl.replace(/player_profile=hls-js/,"player_profile=hls-js-2441");

                title.videoUrl = playoutUrl;
                title.videoUrl = this.replaceTemplate(title.videoUrl,true);


                title.titleId = Id.next();

                Object.assign(title, await this.imageLinks({baseLinkUrl: title.baseLinkUrl, versionHash: title.versionHash, images: title.images}));

                titles[parseInt(title.order)] = title;
              } catch (error) {
                // eslint-disable-next-line no-console
                console.error(`Failed to load title ${titleSlug} in playlist ${order} (${name})`);
                // eslint-disable-next-line no-console
                console.error(error);
              }
            })
          );

          playlists[parseInt(order)] = {
            playlistId: Id.next(),
            name,
            titles: titles.filter(title => title)
          };
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Failed to load playlist ${playlistSlug}`);
          // eslint-disable-next-line no-console
          console.error(error);
        }
      })
    );

    return playlists.filter(playlist => playlist);
  }

  async imageLinks({baseLinkUrl, versionHash, images}) {
    images = images || {};

    let landscapeUrl, portraitUrl, imageUrl, posterUrl;
    if(images.landscape) {
      landscapeUrl = this.createLink(baseLinkUrl, UrlJoin("images", "landscape", "default"));
    } else if(images.main_slider_background_desktop) {
      landscapeUrl = this.createLink(baseLinkUrl, UrlJoin("images", "main_slider_background_desktop", "default"));
    }
    landscapeUrl = this.replaceTemplate(landscapeUrl);

    if(images.poster) {
      portraitUrl = this.createLink(baseLinkUrl, UrlJoin("images", "poster", "default"));
    } else if(images.primary_portrait) {
      portraitUrl = this.createLink(baseLinkUrl, UrlJoin("images", "primary_portrait", "default"));
    } else if(images.portrait) {
      portraitUrl = this.createLink(baseLinkUrl, UrlJoin("images", "portrait", "default"));
    }
    portraitUrl = this.replaceTemplate(portraitUrl);

    imageUrl = await this.client.ContentObjectImageUrl({versionHash});
    imageUrl = this.replaceTemplate(imageUrl);

    posterUrl = landscapeUrl;

    return {
      posterUrl,
      landscapeUrl,
      portraitUrl,
      imageUrl
    };
  }

  createLink(baseLink, path, query={}) {
    const basePath = URI(baseLink).path();

    return URI(baseLink)
      .path(UrlJoin(basePath, path))
      .addQuery(query)
      .toString();
  }

  replaceTemplate(string,query=false){
    if(isEmpty(string)){
      return "";
    }

    if(!isEmpty(this.hostTemplate)){
      let url = new URI(string).host(this.hostTemplate).scheme('');
      //Removes the // at the beginning since we removed the scheme
      url = url.href().substr(2);
      return !query? url:
       url + this.videoQueryTemplate;
    }

    return string;
  }
}