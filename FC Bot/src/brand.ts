import { MINECRAFT_COLORS } from './constants';

export type BrandConfig = {
  useColors: boolean;
  bedrockHost: string;
};

/**
 * Get the branded display name for Fracture MC
 * @param useColors - Whether to include Minecraft color formatting codes
 * @returns Formatted brand name (with or without colors)
 */
export function getBrandDisplay(useColors: boolean): string {
  if (!useColors) {
    return 'Fracture MC';
  }

  // Format: "Fracture" in blue, "MC" in red
  return `${MINECRAFT_COLORS.BLUE}Fracture ${MINECRAFT_COLORS.RED}MC${MINECRAFT_COLORS.RESET}`;
}

export function getSessionText(value: string, useColors: boolean): string {
  if (!useColors) {
    return value;
  }

  return value.replace(/Fracture MC/gi, getBrandDisplay(true));
}

export function getWorldName(config: BrandConfig): string {
  const display = getBrandDisplay(config.useColors);
  return `${display} | ${config.bedrockHost}`;
}
