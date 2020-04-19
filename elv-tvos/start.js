var express = require('express');
var exbars = require('exbars');
var moment = require('moment')
var Fabric = require('./server/fabric');
var Site = require('./server/site');
var Config = require('./config.json');
var {JQ,isEmpty} = require('./server/utils')

var fabric = new Fabric;
var site = null;
var date = "";

const refreshSite = async (config) =>{
  let configUrl = config.configUrl;
  let siteId = config.siteId;
  let privateKey = process.env.PRIVATEKEY;
  if(isEmpty(configUrl)){
    console.error("configUrl not set in config.");
    process.exit(1);
  }

  if(isEmpty(siteId)){
    console.error("siteId not set in config.");
    process.exit(1);
  }

  if(isEmpty(privateKey)){
    console.error("Please 'export PRIVATEKEY=XXXX' before running.");
    process.exit(1);
  }
  
  try{
    await fabric.init({configUrl,privateKey});
    newSite = new Site({fabric, siteId});
    await newSite.loadSite();
    date = moment().format('MM/DD/YYYY h:mm:ss a');
    site = newSite;
  }catch(e){
    console.error(JQ(e));
  }
}

const main = async () => {
  let serverHost = Config.serverHost;
  let serverPort = Config.serverPort || 4001;
  let updateInterval = Config.updateInterval || 60000;

  var app = express();

  app.engine('hbs', exbars({defaultLayout: false}));
  app.set('view engine', 'hbs');

  await refreshSite(Config);
  //Refresh the Site every updateInterval
  setInterval(()=>{refreshSite(Config)}, updateInterval);

  //Serve the main tvml template
  app.get('/index.hbs', async function(req, res) {
    if(site && site.siteInfo){
      const params = {
        title_logo: site.siteInfo.title_logo,
        display_title: site.siteInfo.display_title,
        playlists: site.siteInfo.playlists,
        eluvio_logo: serverHost + ":" + serverPort + "/logo.png",
        date
      };
      res.set('Cache-Control', 'no-cache');
      res.render('index', params);
    }else{
      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });

  const appFunc = async function(req, res) {
    const params = {
      CONFIG_URL: Config.configUrl,
      UPDATE_INTERVAL: updateInterval
    };
    res.type('application/json');
    res.render('application', params);
  };

  //Serve the application.js template
  app.get('/application.js', appFunc);
  //Fix for older app with malformed urls.
  app.get('//application.js', appFunc);
  
  app.use(express.static('static'));

  console.log("Server running on port: " + serverPort);
  
  app.listen(serverPort);
}


main();