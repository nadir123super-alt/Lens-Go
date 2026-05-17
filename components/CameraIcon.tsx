import * as React from "react";
import Svg, { Path } from "react-native-svg";

interface CameraIconProps {
  color?: string;
  size?: number;
  focused?: boolean;
}

const CameraIcon = ({ color = 'rgba(0,0,0,0.35)', size = 28, focused = false }: CameraIconProps) => {
  const fillColor = focused ? "#F7C5BB" : color;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
    >
      <Path
        fill={fillColor}
        d="M888.32 207.39h-89.6v-.05A71.76 71.76 0 0 0 727 135.65H619.52a71.76 71.76 0 0 0-71.68 71.68v.05H135.68A71.76 71.76 0 0 0 64 279.07v537.6a71.76 71.76 0 0 0 71.68 71.68h752.64A71.76 71.76 0 0 0 960 816.67v-537.6a71.76 71.76 0 0 0-71.68-71.68zM252.16 404.45a44.8 44.8 0 1 1 44.8-44.8 44.8 44.8 0 0 1-44.8 44.8zm295.68 376.32c-118.76 0-215-96.28-215-215s96.28-215 215-215 215 96.28 215 215-96.24 215-215 215z"
      />
      <Path
        fill={fillColor}
        d="M547.84 413.41c-84 0-152.32 68.33-152.32 152.32s68.33 152.32 152.32 152.32 152.32-68.33 152.32-152.32-68.33-152.32-152.32-152.32zm0 268.8a116.48 116.48 0 1 1 116.48-116.48 116.61 116.61 0 0 1-116.48 116.48z"
      />
    </Svg>
  );
};

export default CameraIcon;