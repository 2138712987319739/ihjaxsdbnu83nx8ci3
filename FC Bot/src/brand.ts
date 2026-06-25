export type BrandConfig = {
  useColors: boolean;
  bedrockHost: string;
};

export function getBrandDisplay(_useColors: boolean): string {
  void _useColors;
  return 'FractureMC';
}

export function getSessionText(value: string, _useColors: boolean): string {
  void _useColors;
  return stripMinecraftFormatting(value).replace(/Fracture\s*MC/gi, 'FractureMC');
}

export function getWorldName(config: BrandConfig): string {
  return getBrandDisplay(config.useColors);
}

function stripMinecraftFormatting(value: string): string {
  return value.replace(/\u00a7[0-9A-FK-OR]/gi, '');
}
