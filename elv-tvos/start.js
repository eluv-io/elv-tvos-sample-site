var express = require('express');
var exbars = require('exbars');
var moment = require('moment')
var Fabric = require('./server/fabric');
var Site = require('./server/site');
var Config = require('./config.json');
var path = require('path');
var {JQ,isEmpty,CreateID} = require('./server/utils')

var fabric = new Fabric;
var sites = [];
var date = "";

const refreshSites = async (config) =>{
  let configUrl = config.configUrl;
  let privateKey = process.env.PRIVATEKEY;
  if(isEmpty(configUrl)){
    console.error("configUrl not set in config.");
    process.exit(1);
  }

  if(isEmpty(privateKey)){
    console.error("Please 'export PRIVATEKEY=XXXX' before running.");
    process.exit(1);
  }
  
  try{
    await fabric.init({configUrl,privateKey});
    var sitesIds = await fabric.findSites();
    sites = [];
    await Promise.all(
      sitesIds.map(async siteId => {
          console.log("Loading site: " + siteId);
          let newSite = new Site({fabric, siteId});
          await newSite.loadSite();
          // console.log("Site loaded: " + JQ(newSite.siteInfo));
          sites.push(newSite.siteInfo);
          console.log(sites.length);
      })
    );
    // console.log("Sites: " + JQ(sites));
    date = moment().format('MM/DD/YYYY h:mm:ss a');

  }catch(e){
    console.error(e);
  }
}

const main = async () => {
  let serverHost = Config.serverHost;
  let serverPort = Config.serverPort || 4001;
  let updateInterval = Config.updateInterval || 60000;

  var app = express();

  app.engine('hbs', exbars({defaultLayout: false}));
  app.set('view engine', 'hbs');
  app.set('views', path.join(__dirname, '/views'));

  await refreshSites(Config);
  //Refresh the Site every updateInterval
  setInterval(()=>{refreshSites(Config)}, updateInterval);

  app.get('/settings.hbs', async function(req, res) {
    //Keep the templates for the device to inject
    const params = {
      fabric_node:"{{fabric_node}}",
      session_id:"{{session_id}}",
      app_id:"{{app_id}}",
      app_version:"{{app_version}}",
      system_version:"{{system_version}}",
      system_lang:"{{system_lang}}"
    };
      res.set('Cache-Control', 'no-cache');
      res.render("settings", params);
  });

  app.get('/index.hbs', async function(req, res) {
    if(!isEmpty(sites)){
      const params = {
        sites,
        eluvio_logo: serverHost + ":" + serverPort + "/logo.png",
        date
      };
      res.set('Cache-Control', 'no-cache');
      res.render("index", params);
    }else{
      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });

    //Serve the main tvml template
  app.get(['/site.hbs/:index','/watch.hbs/:index'], async function(req, res) {
    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      console.log("Route "+ view + "/" + req.params.index);
      let index = req.params.index;
      let site = sites[index];
      const params = {
        title_logo: site.title_logo,
        display_title: site.display_title,
        playlists: site.playlists,
        eluvio_logo: serverHost + ":" + serverPort + "/logo.png",
        site_index: index,
        date
      };
      res.set('Cache-Control', 'no-cache');
      res.render(view, params);
    }catch(e){
      console.error(e);
      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });


  const appFunc = async function(req, res) {
    let sessionTag = CreateID(8);
    const params = {
      CONFIG_URL: Config.configUrl,
      UPDATE_INTERVAL: updateInterval,
      SESSION_TAG: sessionTag,
      SITES: sites
    };
    res.type('application/json');
    res.render('application', params);
  };

  //Serve the application.js template
  app.get('/application.js', appFunc);
  //Fix for older app with malformed urls.
  app.get('//application.js', appFunc);
  
  app.use(express.static('static'));
  app.use(express.static('views'));

  // catch 404 and forward to error handler
  app.use(function (req, res, next) {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
  });

  console.log("Server running on port: " + serverPort);
  
  app.listen(serverPort);
}


main();