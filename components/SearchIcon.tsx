import * as React from "react";
import Svg, { Path } from "react-native-svg";

interface SearchIconProps {
  color?: string;
  size?: number;
  focused?: boolean;
}

const SEARCH_COLOR = '#90EE90';

const SearchIcon = ({ color = 'rgba(0,0,0,0.35)', size = 28, focused = false }: SearchIconProps) => {
  const fillColor = focused ? SEARCH_COLOR : color;
  
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
    >
      <Path
        fill={fillColor}
        d="M852.3 777.6 723.6 648.9c34.9-53.3 55.6-116.8 55.6-185.2 0-187.1-152.3-339.4-339.4-339.4S100.3 276.6 100.3 463.7s152.3 339.4 339.4 339.4c70.5 0 136.1-21.7 190.4-58.7L757.7 872c13 13 30.1 19.6 47.2 19.6s34.2-6.5 47.2-19.6c26.3-26 26.3-68.3.2-94.4zM233.9 463.7c0-113.5 92.4-205.9 205.9-205.9s205.9 92.4 205.9 205.9-92.4 205.9-205.9 205.9-205.9-92.4-205.9-205.9z"
      />
    </Svg>
  );
};

export default SearchIcon;
