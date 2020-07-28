
var {isEmpty, JQ} = require('./utils');
var URI = require("urijs");
var UrlJoin = require("url-join");
var Id = require("@eluvio/elv-client-js/src/Id");
var UUID = require("uuid");

class Site {
  constructor({fabric, siteId, hostTemplate="{{{host}}}"}, videoQueryTemplate="{{params}}") {
    this.fabric = fabric;
    this.client = fabric.client;
    this.siteId = siteId;
    this.hostTemplate = hostTemplate;
    this.videoQueryTemplate = videoQueryTemplate;
    this.titleStore = {};
  }

  async loadSite() {
    try {

      if(!this.siteLibraryId){
        this.siteLibraryId = await this.client.ContentObjectLibraryId({objectId: this.siteId});
      }

      const versionHash = await this.client.LatestVersionHash({objectId: this.siteId});

      this.siteInfo = await this.client.ContentObjectMetadata({
        siteId: this.siteId,
        versionHash,
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
          UUID()
        ]
        */
      });

      this.siteInfo.baseLinkUrl = await this.client.LinkUrl({
        libraryId: this.siteLibraryId,
        objectId: this.siteId,
        linkPath: "public/asset_metadata"
      });

      //Top left logo
      this.siteInfo.title_logo = this.createLink(
        this.siteInfo.baseLinkUrl,
        "images/title_logo/thumbnail"
      );
      this.siteInfo.title_logo = this.replaceTemplate(this.siteInfo.title_logo)

      //Site selection Screen
      this.siteInfo.landscape_logo = this.createLink(
        this.siteInfo.baseLinkUrl,
        "images/landscape/default"
      );
      this.siteInfo.landscape_logo = this.replaceTemplate(this.siteInfo.landscape_logo)

      //Background image
      this.siteInfo.main_background = this.createLink(
        this.siteInfo.baseLinkUrl,
        "images/main_background/default"
      );

      this.siteInfo.main_background = this.replaceTemplate(this.siteInfo.main_background)
      
      this.siteInfo.playlists = await this.loadPlaylists(versionHash, this.siteInfo.playlists);
      this.siteInfo.series = await this.loadTitles(versionHash, "series", this.siteInfo.series);
      this.siteInfo.seasons = await this.loadTitles(versionHash, "seasons", this.siteInfo.seasons);
      this.siteInfo.episodes = await this.loadTitles(versionHash, "episodes", this.siteInfo.episodes);
      this.siteInfo.titles = await this.loadTitles(versionHash, "titles", this.siteInfo.titles);
      this.siteInfo.channels = await this.loadTitles(versionHash, "channels", this.siteInfo.channels);

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
                if(!title.versionHash){
                  console.error("Error loading title: " + titleSlug + " " + JQ(title));
                  return;
                }
                title.objectId = this.client.utils.DecodeVersionHash(title.versionHash).objectId;
                const titleLinkPath = `public/asset_metadata/playlists/${playlistSlug}/list/${titleSlug}`;
                title.baseLinkPath = titleLinkPath;
                title.baseLinkUrl =
                  await this.client.LinkUrl({versionHash, linkPath: titleLinkPath});
                title.playoutOptionsLinkPath = UrlJoin(titleLinkPath, "sources", "default");
              
                //For lazy loading the offerings
                title.getAvailableOfferings = async () =>{
                  title.availableOfferings = await this.getAvailableOfferings(title);
                  //console.log("AvailableOfferings: " + JQ(title.availableOfferings));
                }
                
                Object.assign(title, await this.imageLinks({baseLinkUrl: title.baseLinkUrl, versionHash: title.versionHash, images: title.images}));

                titles[parseInt(title.order)] = title;
                this.titleStore[title.versionHash] = title;
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
            titles: titles.filter(title => title),
            order
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

  async loadTitles(versionHash, metadataKey, titleInfo) {
    if(!titleInfo) { return []; }

    // Titles: {[index]: {[title-key]: { ...title }}
    let titles = [];
    await Promise.all(
      Object.keys(titleInfo).map(async index => {
        try {
          const titleKey = Object.keys(titleInfo[index])[0];
          let title = titleInfo[index][titleKey];

          if(title["."].resolution_error) {
            return;
          }

          title.displayTitle = title.display_title || title.title || "";
          title.versionHash = title["."].source;
          title.objectId = this.client.utils.DecodeVersionHash(title.versionHash).objectId;

          const linkPath = UrlJoin("public", "asset_metadata", metadataKey, index, titleKey);
          title.playoutOptionsLinkPath = UrlJoin(linkPath, "sources", "default");
          title.baseLinkPath = linkPath;
          title.baseLinkUrl =
            await this.client.LinkUrl({versionHash, linkPath});

          //For lazy loading the offerings
          title.getAvailableOfferings = async () =>{
            title.availableOfferings = await this.getAvailableOfferings(title);
          }

          title.getVideoUrl = async(offeringKey) => {
            // console.log("Getting getVideoUrl for " + title.displayTitle + " offering: " + offeringKey);
            if(!title.availableOfferings){
              await title.getAvailableOfferings();
            }

            let offering = title.availableOfferings[offeringKey];
            let videoUrl = offering.videoUrl;
            if(!videoUrl){
              videoUrl = await offering.getVideoUrl(offeringKey);
            }

            console.log("Found video url " + videoUrl);
            return videoUrl;
          }

          Object.assign(title, await this.imageLinks({baseLinkUrl: title.baseLinkUrl, versionHash: title.versionHash, images: title.images}));

          titles[index] = title;
          this.titleStore[title.versionHash] = title;
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Failed to load title ${index}`);
          // eslint-disable-next-line no-console
          console.error(error);
        }
      })
    );

    return titles.filter(title => title);
  }

  async getAvailableOfferings(title){
    let allowedOfferings = [];
    var newAvailableOfferings = {};
    let availableOfferings = {};
    try {
      availableOfferings = await this.client.AvailableOfferings({versionHash: title.versionHash});
      if(!isEmpty(this.siteInfo.allowed_offerings)){
        allowedOfferings = this.siteInfo.allowed_offerings;
      }
      
      for (const key in availableOfferings) {
        if(allowedOfferings.length > 0 && !allowedOfferings.includes(key)){
          continue;
        }

        let offering = availableOfferings[key];
        offering.key = key;

        offering.getVideoUrl = async (key)=>{
          let playoutOptions = await this.client.PlayoutOptions({
            libraryId: this.siteLibraryId,
            objectId: this.siteId,
            linkPath: title.playoutOptionsLinkPath,
            protocols: ["hls", "dash"],
            drms: ["sample-aes", "clear"],
            offering: key
          });
          let playoutUrl = (playoutOptions.hls.playoutMethods.clear || playoutOptions.hls.playoutMethods["sample-aes"]).playoutUrl;
          offering.videoUrl = this.replaceTemplate(playoutUrl,true);
          return offering.videoUrl;
        }
        
        if(offering.display_name == "default"){
          offering.display_name = "Watch";
        }

        newAvailableOfferings[key] = offering;
      }
      

    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to get offerings for ${title.displayTitle}: `);
      // eslint-disable-next-line no-console
      console.error(error);
    }
    if(isEmpty(newAvailableOfferings)){
      newAvailableOfferings = availableOfferings;
    }
    return newAvailableOfferings;
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
    posterUrl = landscapeUrl;

    return {
      posterUrl,
      landscapeUrl,
      portraitUrl,
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

module.exports = {
  Site,
}