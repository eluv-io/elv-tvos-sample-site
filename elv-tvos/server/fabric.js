const { ElvClient } = require('@eluvio/elv-client-js/src/ElvClient');

module.exports = class Fabric {
  async init({configUrl, privateKey}){
    this.client = await ElvClient.FromConfigurationUrl({ configUrl });
    this.wallet = this.client.GenerateWallet();
    this.signer = this.wallet.AddAccount({
      privateKey
    });
    this.client.SetSigner({signer:this.signer});
    this.configUrl = configUrl;
  }
}

