export const CONFIG = {
  MURAL_API_URL: process.env.MURAL_API_URL || 'https://api-staging.muralpay.com',
  MURAL_API_KEY:
    process.env.MURAL_API_KEY ||
    '60896bf5534ef260793e9b92:b8d4cea3b7c00aaf3bdd889b78949fe1ce151a3a25fc31a4ece01f7216b12de61869bfe9:78a52990f61cc6512988afca6c4e3c54.22bdea754702b50b0591b0c0d591ad4a3201523718d6f5430d243ee17cd83699',
  MURAL_TRANSFER_API_KEY:
    process.env.MURAL_TRANSFER_KEY ||
    '6629d57697a1cad97f316946:b2dbf0305273293d3f8517c38423f41e03baeef865bfea4a48365402e254bc3e5198e753:e529f58ae9f27fc713d282b207970629.18e55a2fc53835d701b9415738d47076b770a254b19f782abc5dad0046c057b4',

  // Merchant's Colombian bank details for COP payouts (test data for sandbox)
  MERCHANT_BANK: {
    bankName: 'Bancolombia',
    bankAccountOwner: 'Marketplace Merchant',
    recipientFirstName: 'Marketplace',
    recipientLastName: 'Merchant',
    recipientEmail: 'merchant@marketplace.test',
    recipientAddress: {
      address1: 'Calle 100 #19-61',
      city: 'Bogota',
      state: 'CO-DC',
      country: 'CO',
      zip: '110111',
    },
    fiatDetails: {
      type: 'cop' as const,
      symbol: 'COP' as const,
      phoneNumber: '+573001234567',
      accountType: 'SAVINGS' as const,
      bankAccountNumber: '123456789012',
      documentNumber: '1234567890',
      documentType: 'NATIONAL_ID' as const,
    },
  },

  // Populated at startup by bootstrap service
  webhookPublicKey: '',
  muralAccountId: '',
  depositWalletAddress: '',
};
