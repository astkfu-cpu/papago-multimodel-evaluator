(function attachPapagoHighlightDetector(root) {
  function locate(pixels, width, height) {
    if (!pixels || width < 3 || height < 3 || pixels.length < width * height * 4) return null;
    const warmMask = new Uint8Array(width * height);
    const blueMask = new Uint8Array(width * height);
    const fallbackMask = new Uint8Array(width * height);

    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const warm = isGrayYellow(red, green, blue);
      const frameBlue = isFrameBlue(red, green, blue);
      const lime = green > 170 && red > 95 && blue < 125 && green - blue > 45;
      if (warm) warmMask[index] = 1;
      if (frameBlue) blueMask[index] = 1;
      if (warm || frameBlue || lime) fallbackMask[index] = warm ? 1 : frameBlue ? 2 : 3;
    }

    const frameCandidates = findFrameCandidates(blueMask, warmMask, width, height);
    const reliableFrames = frameCandidates.filter((candidate) => {
      const classicOverlay = candidate.frameQuality >= 0.30 && candidate.warmCoverage >= 0.45;
      const tintedOverlay = candidate.fromLinePair && candidate.frameQuality >= 0.84 && candidate.warmCoverage >= 0.006 &&
        (candidate.maxX - candidate.minX + 1) * (candidate.maxY - candidate.minY + 1) <= width * height * 0.16;
      return classicOverlay || tintedOverlay;
    });
    if (reliableFrames.length) {
      reliableFrames.sort((first, second) => second.score - first.score);
      const best = reliableFrames[0];
      const runnerUp = reliableFrames[1];
      const separation = runnerUp ? best.score / Math.max(1, runnerUp.score) : 3;
      return {
        ...best,
        mode: "blue-frame",
        confidence: clamp(0.78 + best.frameQuality * 0.18 + Math.min(0.04, (separation - 1) * 0.04), 0.78, 0.99),
        candidateCount: reliableFrames.length,
        separation
      };
    }

    const fallbackCandidates = findFallbackCandidates(fallbackMask, width, height);
    if (!fallbackCandidates.length) return null;
    fallbackCandidates.sort((first, second) => second.score - first.score);
    const best = fallbackCandidates[0];
    const runnerUp = fallbackCandidates[1];
    const separation = runnerUp ? best.score / Math.max(1, runnerUp.score) : 2;
    return {
      ...best,
      mode: "color-fallback",
      confidence: clamp((best.warmRatio >= 0.6 ? 0.72 : 0.52) + Math.min(0.12, (separation - 1) * 0.08), 0.45, 0.88),
      candidateCount: fallbackCandidates.length,
      separation
    };
  }

  function isGrayYellow(red, green, blue) {
    const average = (red + green) / 2;
    const yellowStrength = average - blue;
    return average >= 135 && Math.abs(red - green) <= 52 && yellowStrength >= 18 && red - blue >= 22;
  }

  function isFrameBlue(red, green, blue) {
    const blueStrength = blue - (red + green) / 2;
    return blue >= 118 && green >= 72 && blue - red >= 24 && blue - green >= 8 && blueStrength >= 18;
  }

  function findContentBounds(pixels, width, height) {
    if (!pixels || width < 40 || height < 40 || pixels.length < width * height * 4) return null;
    const sampleWidth = Math.max(2, Math.round(width * 0.025));
    const sampleStep = Math.max(1, Math.round(height / 90));
    const bandStats = (startX, endX) => {
      const values = [];
      for (let y = Math.round(height * 0.03); y < Math.round(height * 0.88); y += sampleStep) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          values.push([pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
        }
      }
      const median = [0, 1, 2].map((channel) => {
        const sorted = values.map((value) => value[channel]).sort((first, second) => first - second);
        return sorted[Math.floor(sorted.length / 2)] || 0;
      });
      const uniformRatio = values.filter((value) =>
        Math.abs(value[0] - median[0]) + Math.abs(value[1] - median[1]) + Math.abs(value[2] - median[2]) <= 24
      ).length / Math.max(1, values.length);
      return { median, uniformRatio };
    };
    const leftBand = bandStats(0, sampleWidth);
    const rightBand = bandStats(width - sampleWidth, width);
    const edgeDistance = Math.abs(leftBand.median[0] - rightBand.median[0]) + Math.abs(leftBand.median[1] - rightBand.median[1]) + Math.abs(leftBand.median[2] - rightBand.median[2]);
    if (leftBand.uniformRatio < 0.78 || rightBand.uniformRatio < 0.78 || edgeDistance > 45) return null;
    const background = [0, 1, 2].map((channel) => (leftBand.median[channel] + rightBand.median[channel]) / 2);
    const active = new Uint8Array(width);
    const rowStart = Math.round(height * 0.03);
    const rowEnd = Math.round(height * 0.88);
    const rowStep = Math.max(1, Math.round((rowEnd - rowStart) / 160));
    for (let x = 0; x < width; x += 1) {
      let different = 0;
      let samples = 0;
      for (let y = rowStart; y < rowEnd; y += rowStep) {
        const offset = (y * width + x) * 4;
        const distance = Math.abs(pixels[offset] - background[0]) + Math.abs(pixels[offset + 1] - background[1]) + Math.abs(pixels[offset + 2] - background[2]);
        if (distance >= 52) different += 1;
        samples += 1;
      }
      if (different / Math.max(1, samples) >= 0.11) active[x] = 1;
    }
    const bridge = Math.max(2, Math.round(width * 0.012));
    let previous = -1;
    for (let x = 0; x < width; x += 1) {
      if (!active[x]) continue;
      if (previous >= 0 && x - previous - 1 <= bridge) {
        for (let fillX = previous + 1; fillX < x; fillX += 1) active[fillX] = 1;
      }
      previous = x;
    }
    const runs = [];
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      if (x < width && active[x]) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        runs.push({ minX: start, maxX: x - 1, width: x - start });
        start = -1;
      }
    }
    const best = runs.sort((first, second) => second.width - first.width)[0];
    if (!best || best.width < width * 0.14 || best.width > width * 0.94) return null;
    const padding = Math.max(1, Math.round(width * 0.008));
    return {
      minX: Math.max(0, best.minX - padding),
      minY: 0,
      maxX: Math.min(width - 1, best.maxX + padding),
      maxY: height - 1
    };
  }

  function findFrameCandidates(blueMask, warmMask, width, height) {
    const dilated = dilate(blueMask, width, height, 2);
    const components = connectedComponents(dilated, width, height, 1);
    const candidates = [];
    for (const component of components) {
      let { minX, minY, maxX, maxY } = component;
      minX = Math.min(maxX, minX + 2);
      minY = Math.min(maxY, minY + 2);
      maxX = Math.max(minX, maxX - 2);
      maxY = Math.max(minY, maxY - 2);
      const candidate = scoreFrameBox(blueMask, warmMask, width, height, minX, minY, maxX, maxY, false);
      if (candidate) candidates.push(candidate);
    }
    candidates.push(...findPairedLineFrames(blueMask, warmMask, width, height));
    return deduplicateFrames(candidates);
  }

  function findPairedLineFrames(blueMask, warmMask, width, height) {
    const segments = [];
    for (let y = 0; y < height; y += 1) {
      const columns = new Uint8Array(width);
      for (let x = 0; x < width; x += 1) {
        for (let dy = -2; dy <= 2; dy += 1) {
          const nextY = y + dy;
          if (nextY >= 0 && nextY < height && blueMask[nextY * width + x]) {
            columns[x] = 1;
            break;
          }
        }
      }
      let left = -1;
      let right = -1;
      let count = 0;
      for (let x = 0; x < width; x += 1) {
        if (!columns[x]) continue;
        if (left < 0) left = x;
        right = x;
        count += 1;
      }
      if (left < 0) continue;
      const span = right - left + 1;
      const coverage = count / Math.max(1, span);
      if (span >= 8 && coverage >= 0.18) segments.push({ y, left, right, coverage });
    }

    const candidates = [];
    for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
      const top = segments[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
        const bottom = segments[secondIndex];
        const boxHeight = bottom.y - top.y;
        if (boxHeight < 6) continue;
        if (boxHeight > height * 0.55) break;
        const overlap = Math.max(0, Math.min(top.right, bottom.right) - Math.max(top.left, bottom.left) + 1);
        const shorter = Math.min(top.right - top.left + 1, bottom.right - bottom.left + 1);
        if (overlap / Math.max(1, shorter) < 0.68) continue;
        const averageWidth = ((top.right - top.left + 1) + (bottom.right - bottom.left + 1)) / 2;
        const endpointTolerance = Math.max(6, averageWidth * 0.12);
        if (Math.abs(top.left - bottom.left) > endpointTolerance || Math.abs(top.right - bottom.right) > endpointTolerance) continue;
        const minX = Math.min(top.left, bottom.left);
        const maxX = Math.max(top.right, bottom.right);
        const candidate = scoreFrameBox(blueMask, warmMask, width, height, minX, top.y, maxX, bottom.y, true);
        if (candidate) candidates.push(candidate);
      }
    }
    return candidates;
  }

  function scoreFrameBox(blueMask, warmMask, width, height, minX, minY, maxX, maxY, fromLinePair) {
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const area = boxWidth * boxHeight;
    if (boxWidth < 7 || boxHeight < 6 || area > width * height * 0.48) return null;
    if (boxWidth > width * 0.94 || boxHeight > height * 0.86) return null;
    const band = Math.max(2, Math.min(6, Math.round(Math.min(boxWidth, boxHeight) * 0.12)));
    const top = horizontalCoverage(blueMask, width, height, minX, maxX, minY, band);
    const bottom = horizontalCoverage(blueMask, width, height, minX, maxX, maxY, band);
    const left = verticalCoverage(blueMask, width, height, minY, maxY, minX, band);
    const right = verticalCoverage(blueMask, width, height, minY, maxY, maxX, band);
    const sides = [top, right, bottom, left];
    const strongSides = sides.filter((value) => value >= 0.18).length;
    const horizontalEvidence = fromLinePair ? Math.min(top, bottom) : Math.max(top, bottom);
    const verticalEvidence = Math.max(left, right);
    if (strongSides < 3 && !(horizontalEvidence >= 0.38 && verticalEvidence >= 0.10)) return null;
    const sideAverage = sides.reduce((sum, value) => sum + value, 0) / 4;
    const oppositeEvidence = (Math.min(top, bottom) + Math.min(left, right)) / 2;
    const frameQuality = clamp(sideAverage * 0.58 + oppositeEvidence * 0.42, 0, 1);
    const warmCoverage = interiorCoverage(warmMask, width, minX, minY, maxX, maxY, band);
    const aspect = boxWidth / Math.max(1, boxHeight);
    const aspectWeight = aspect >= 0.30 && aspect <= 18 ? 1 : 0.52;
    const perimeter = boxWidth * 2 + boxHeight * 2;
    const linePairWeight = fromLinePair ? 1.18 : 1;
    const score = perimeter * Math.pow(0.45 + frameQuality, 2.4) * (1 + warmCoverage * 1.4) * aspectWeight * linePairWeight;
    return { minX, minY, maxX, maxY, score, frameQuality, warmCoverage, sides, aspect, fromLinePair };
  }

  function deduplicateFrames(candidates) {
    const sorted = [...candidates].sort((first, second) => second.score - first.score);
    const kept = [];
    for (const candidate of sorted) {
      if (kept.some((existing) => intersectionOverUnion(candidate, existing) >= 0.72)) continue;
      kept.push(candidate);
    }
    return kept;
  }

  function intersectionOverUnion(first, second) {
    const left = Math.max(first.minX, second.minX);
    const top = Math.max(first.minY, second.minY);
    const right = Math.min(first.maxX, second.maxX);
    const bottom = Math.min(first.maxY, second.maxY);
    const intersection = Math.max(0, right - left + 1) * Math.max(0, bottom - top + 1);
    const firstArea = (first.maxX - first.minX + 1) * (first.maxY - first.minY + 1);
    const secondArea = (second.maxX - second.minX + 1) * (second.maxY - second.minY + 1);
    return intersection / Math.max(1, firstArea + secondArea - intersection);
  }

  function findFallbackCandidates(mask, width, height) {
    const components = connectedComponents(mask, width, height, 2);
    const candidates = [];
    for (const component of components) {
      const { minX, minY, maxX, maxY, count, colorCounts } = component;
      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const area = boxWidth * boxHeight;
      if (count < 5 || boxWidth < 3 || boxHeight < 3 || area > width * height * 0.30) continue;
      if (boxWidth > width * 0.84 || boxHeight > height * 0.52) continue;
      const aspect = boxWidth / Math.max(1, boxHeight);
      if (aspect < 0.65 && boxHeight > height * 0.12) continue;
      const density = count / Math.max(1, area);
      const warmRatio = colorCounts[1] / Math.max(1, count);
      const blueRatio = colorCounts[2] / Math.max(1, count);
      const shapeWeight = aspect >= 1.35 && aspect <= 16 ? 2.1 : aspect < 0.45 ? 0.38 : 1;
      const mixedWeight = warmRatio >= 0.08 && blueRatio >= 0.012 ? 1.8 : 1;
      const score = count * (1 + Math.min(2, density * 4)) * shapeWeight * (0.45 + warmRatio * 4.2) * mixedWeight;
      candidates.push({ minX, minY, maxX, maxY, score, warmRatio, blueRatio, density, aspect, frameQuality: 0 });
    }
    return candidates;
  }

  function dilate(mask, width, height, radius) {
    const output = new Uint8Array(mask.length);
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask[index]) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -radius; dy <= radius; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nextX = x + dx;
          if (nextX >= 0 && nextX < width) output[nextY * width + nextX] = 1;
        }
      }
    }
    return output;
  }

  function connectedComponents(mask, width, height, gap) {
    const visited = new Uint8Array(mask.length);
    const queue = new Int32Array(mask.length);
    const components = [];
    const offsets = [
      -1, 1, -width, width,
      -width - 1, -width + 1, width - 1, width + 1
    ];
    if (gap >= 2) offsets.push(-2, 2, -width * 2, width * 2);
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let count = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      const colorCounts = [0, 0, 0, 0];
      while (head < tail) {
        const current = queue[head++];
        const x = current % width;
        const y = Math.floor(current / width);
        count += 1;
        colorCounts[mask[current]] += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        for (const offset of offsets) {
          const next = current + offset;
          if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
          if (Math.abs(next % width - x) > gap) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      components.push({ minX, minY, maxX, maxY, count, colorCounts });
    }
    return components;
  }

  function horizontalCoverage(mask, width, height, minX, maxX, y, band) {
    let hits = 0;
    let samples = 0;
    for (let x = minX; x <= maxX; x += 1) {
      samples += 1;
      let found = false;
      for (let dy = -band; dy <= band; dy += 1) {
        const nextY = y + dy;
        if (nextY >= 0 && nextY < height && mask[nextY * width + x]) {
          found = true;
          break;
        }
      }
      if (found) hits += 1;
    }
    return hits / Math.max(1, samples);
  }

  function verticalCoverage(mask, width, height, minY, maxY, x, band) {
    let hits = 0;
    let samples = 0;
    for (let y = minY; y <= maxY; y += 1) {
      samples += 1;
      let found = false;
      for (let dx = -band; dx <= band; dx += 1) {
        const nextX = x + dx;
        if (nextX >= 0 && nextX < width && mask[y * width + nextX]) {
          found = true;
          break;
        }
      }
      if (found) hits += 1;
    }
    return hits / Math.max(1, samples);
  }

  function interiorCoverage(mask, width, minX, minY, maxX, maxY, inset) {
    let hits = 0;
    let samples = 0;
    const startX = Math.min(maxX, minX + inset);
    const endX = Math.max(startX, maxX - inset);
    const startY = Math.min(maxY, minY + inset);
    const endY = Math.max(startY, maxY - inset);
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        samples += 1;
        if (mask[y * width + x]) hits += 1;
      }
    }
    return hits / Math.max(1, samples);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  root.PapagoHighlightDetector = { locate, findContentBounds, isGrayYellow, isFrameBlue };
})(globalThis);
