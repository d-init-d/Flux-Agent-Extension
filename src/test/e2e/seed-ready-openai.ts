import { CredentialVault } from '../../background/credential-vault';

export async function seedReadyOpenAiVaultFixture(): Promise<void> {
  const vault = new CredentialVault();
  await vault.init('test-passphrase');
  await vault.setCredential('openai', 'sk-openai-e2e');
  await vault.markValidated('openai');
}
