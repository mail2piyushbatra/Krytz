import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

export default function AnimatedCounter({ value, style }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value && prevValue.current !== undefined) {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scaleAnim, { toValue: 1.3, duration: 150, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0.6, duration: 150, useNativeDriver: true })
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true })
        ])
      ]).start();
    }
    prevValue.current = value;
  }, [value]);

  return (
    <Animated.Text style={[style, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
      {value}
    </Animated.Text>
  );
}
