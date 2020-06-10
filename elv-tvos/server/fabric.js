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

  async initFromEncrypted({configUrl, encryptedPrivateKey, password}){
    this.client = await ElvClient.FromConfigurationUrl({ configUrl });
    this.wallet = this.client.GenerateWallet();
    this.signer = await this.wallet.AddAccountFromEncryptedPK({encryptedPrivateKey, password});
    this.client.SetSigner({signer:this.signer});
    this.configUrl = configUrl;
  }

  async findSites() {
    let sites = [];

    const contentSpaceLibraryId =
      this.client.utils.AddressToLibraryId(
        this.client.utils.HashToAddress(
          await this.client.ContentSpaceId()
        )
      );

    const groupAddresses = await this.client.Collection({collectionType: "accessGroups"});
    await Promise.all(
      groupAddresses.map(async groupAddress => {
        try {
          const groupSites = await this.client.ContentObjectMetadata({
            libraryId: contentSpaceLibraryId,
            objectId: this.client.utils.AddressToObjectId(groupAddress),
            metadataSubtree: "sites"
          });

          if(!groupSites || !groupSites.length) { return; }

          groupSites.forEach(siteId => sites.push(siteId));
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("Failed to retrieve group metadata for ", groupAddress);
          // eslint-disable-next-line no-console
          console.error(error);
        }
      })
    );

    return sites.filter((value, index, list) => list.indexOf(value) === index);
  }
}

