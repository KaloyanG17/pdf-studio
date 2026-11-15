import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeProvider, DeepLProvider, LANGUAGES, MyMemoryProvider, TranslationProvider } from './providers';

@Injectable()
export class TranslateService {
  private readonly log = new Logger(TranslateService.name);
  private readonly providers: Record<string, TranslationProvider> = {};
  private readonly defaultProvider: string;

  constructor(config: ConfigService) {
    const deepl = config.get<string>('DEEPL_API_KEY');
    const anthropic = config.get<string>('ANTHROPIC_API_KEY');
    if (deepl) this.providers.deepl = new DeepLProvider(deepl);
    if (anthropic) this.providers.claude = new ClaudeProvider(anthropic, config.get('ANTHROPIC_MODEL') || 'claude-opus-5-5');
    this.providers.mymemory = new MyMemoryProvider(config.get('MYMEMORY_EMAIL') || undefined);

    const wanted = config.get<string>('TRANSLATION_PROVIDER');
    this.defaultProvider =
      wanted && this.providers[wanted] ? wanted : this.providers.deepl ? 'deepl' : this.providers.claude ? 'claude' : 'mymemory';
    this.log.log(`Translation providers: ${Object.keys(this.providers).join(', ')} (default: ${this.defaultProvider})`);
  }

  info() {
    return {
      defaultProvider: this.defaultProvider,
      providers: Object.entries(this.providers).map(([id, p]) => ({ id, name: p.name })),
      languages: LANGUAGES,
    };
  }

  async translate(texts: string[], source: string, target: string, providerId?: string) {
    if (!Array.isArray(texts) || texts.some((t) => typeof t !== 'string')) throw new BadRequestException('texts must be string[]');
    if (!LANGUAGES[target]) throw new BadRequestException(`Unsupported target language ${target}`);
    if (source !== 'auto' && !LANGUAGES[source]) throw new BadRequestException(`Unsupported source language ${source}`);
    const id = providerId && this.providers[providerId] ? providerId : this.defaultProvider;
    const provider = this.providers[id];
    if (!texts.length) return { provider: provider.name, translations: [] };
    try {
      const translations = await provider.translate(texts, source, target);
      return { provider: provider.name, translations };
    } catch (e) {
      this.log.error(e);
      throw new BadGatewayException((e as Error).message);
    }
  }
}
