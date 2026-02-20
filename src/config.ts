export const CONFIG = {
  MURAL_API_URL: process.env.MURAL_API_URL || 'https://api-staging.muralpay.com',
  MURAL_API_KEY: process.env.MURAL_API_KEY || '',
  MURAL_TRANSFER_API_KEY: process.env.MURAL_TRANSFER_KEY || '',

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
