const { ElvClient } = require('@eluvio/elv-client-js/src/ElvClient');

module.exports = class Fabric {
  async init({configUrl, privateKey}){
    let region = "na-west-south";
    this.client = await ElvClient.FromConfigurationUrl({ configUrl, region });
    console.log('client configured.');
    this.wallet = this.client.GenerateWallet();
    console.log('wallet generated.');
    this.signer = this.wallet.AddAccount({
      privateKey
    });
    this.client.SetSigner({signer:this.signer});
    console.log('signer set.')
    this.configUrl = configUrl;
  }
}

